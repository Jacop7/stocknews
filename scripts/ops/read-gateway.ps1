# Hosted preview read gateway on the AWS worker: deploy | status | stop.
# deploy: packages the committed gateway sources (git archive of HEAD) on top of the running collector image, uploads
#         the CLOUD10B approved preview config, proof and its bound files (publishable key only, never printed), and
#         starts the "judoju-news-read" compose project: the gateway on 127.0.0.1:62331 and Caddy serving
#         https://52-79-247-25.sslip.io (Let's Encrypt) in front of it. Needs ports 80 and 443 open on the instance.
# status: container health and one HTTPS read of the catalog version (no keys printed).
param([Parameter(Mandatory = $true)][ValidateSet('deploy', 'status', 'stop')][string]$Command)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$keys = Join-Path $repo '.local-data\collector-cloud\ssh-lightsail'
$server = 'ubuntu@52.79.247.25'; $base = '/home/ubuntu/.local/share/judoju-read'; $collector = 'judoju-news-html-collector-collector-1'
$hostName = '52-79-247-25.sslip.io'
$ssh = @('-i', "$keys\judoju-collector-ed25519", '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', "UserKnownHostsFile=$keys\known_hosts_lightsail",
  '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'HostKeyAlgorithms=ssh-ed25519')
function Invoke-Remote([string]$script) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($script -replace "`r", '')))
  $output = ssh.exe @ssh $server "echo $encoded | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) { $output; throw "Remote step failed (exit $LASTEXITCODE)" }
  return $output
}
$statusScript = @'
for c in judoju-news-read-gateway-1 judoju-news-read-proxy-1; do
  sudo -n docker inspect --format "$c running={{.State.Running}} health={{if .State.Health}}{{.State.Health.Status}}{{end}} restarts={{.RestartCount}} image={{.Config.Image}}" $c 2>/dev/null || echo "$c missing"
done
curl -s -m 10 -o /dev/null -w 'https_catalog=%{http_code}\n' https://__HOST__/v2/catalog || echo 'https_catalog=unreachable'
'@.Replace('__HOST__', $hostName)
if ($Command -eq 'status') { Invoke-Remote $statusScript; return }
if ($Command -eq 'stop') { Invoke-Remote "cd $base/current && sudo -n docker compose stop"; return }

$sources = @('scripts/cloud-preview-hosted.mjs', 'scripts/cloud-preview-public-read.mjs', 'scripts/public-read-gateway.mjs', 'scripts/home-public-read.mjs',
  'scripts/catalog/public-route.mjs', 'scripts/catalog/search-route.mjs', 'workers/home-ranking/src', 'docs/cloud/cloud10b-acl-inventory.json')
$dirty = git -C $repo status --porcelain -- @sources
if ($dirty) { throw 'Gateway sources have uncommitted changes; commit first.' }
$private = Join-Path $repo '.local-data\cloud-preview'
$files = 'public-config.json', 'access-proof.json', 'user-authorization.txt', 'live-result.json'
foreach ($file in $files) { if (-not (Test-Path (Join-Path $private $file))) { throw "Missing .local-data\cloud-preview\$file (run CLOUD10B activation first)" } }
$commit = (git -C $repo rev-parse --short HEAD).Trim()
$stage = Join-Path $env:TEMP "judoju-read-$commit"; Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $stage | Out-Null
git -C $repo archive --format=tar -o (Join-Path $stage 'gateway.tar') HEAD @sources
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
$baseImage = (Invoke-Remote "sudo -n docker inspect --format '{{.Config.Image}}' $collector").Trim()
if ($baseImage -notmatch '^judoju-news-html-collector:[A-Za-z0-9._-]+$') { throw "Unexpected collector image: $baseImage" }
@"
FROM $baseImage
LABEL com.judoju.product="judoju-news" com.judoju.component="read-gateway" com.judoju.source-commit="$commit"
USER root
ADD gateway.tar /opt/judoju/
RUN install -d -o node -g node /opt/judoju/.local-data/cloud-preview
USER node
CMD ["node", "--experimental-strip-types", "scripts/cloud-preview-hosted.mjs"]
"@ | Set-Content "$stage\Dockerfile" -Encoding ascii
@"
$hostName {
	header -Server
	reverse_proxy 127.0.0.1:62331 {
		header_up Host 127.0.0.1:62331
		header_up X-Forwarded-For {remote_host}
	}
}
"@ | Set-Content "$stage\Caddyfile" -Encoding ascii
@"
name: judoju-news-read
services:
  gateway:
    image: judoju-news-read-gateway:$commit
    init: true
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    network_mode: host
    restart: unless-stopped
    volumes:
      - $base/private:/opt/judoju/.local-data/cloud-preview:ro
    tmpfs: [/tmp]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:62331/v2/catalog',{headers:{'X-Forwarded-For':'127.0.0.1'}}).then(r=>process.exit(r.status===200?0:1),()=>process.exit(1))"]
      interval: 60s
      timeout: 10s
      retries: 3
  proxy:
    image: caddy:2.8.4
    network_mode: host
    restart: unless-stopped
    read_only: true
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    security_opt: [no-new-privileges:true]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [gateway]
volumes:
  caddy_data:
    labels:
      com.judoju.product: judoju-news
  caddy_config:
    labels:
      com.judoju.product: judoju-news
"@ | Set-Content "$stage\compose.yaml" -Encoding ascii
$remote = (ssh.exe @ssh $server "install -d -m 700 $base $base/private && mktemp -d $base/release-$commit.XXXXXXXX").Trim()
if ($remote -notmatch "^$([regex]::Escape($base))/release-$commit\.[A-Za-z0-9]{8}$") { throw "Unexpected remote dir: $remote" }
scp.exe @ssh "$stage\gateway.tar" "$stage\Dockerfile" "$stage\Caddyfile" "$stage\compose.yaml" "${server}:$remote/"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed' }
# Approved preview files (publishable key, proof and its bound files) go to a private directory; never printed.
foreach ($file in $files) { scp.exe @ssh (Join-Path $private $file) "${server}:$base/private/$file"; if ($LASTEXITCODE -ne 0) { throw "Upload of $file failed" } }
$deploy = @'
set -euo pipefail
R=__REMOTE__; B=__BASE__; T=judoju-news-read-gateway:__COMMIT__
# The container user (node, uid 1000) must read the private files; nobody else on the host can.
sudo -n chown -R 1000:1000 "$B/private"; sudo -n chmod 700 "$B/private"; sudo -n chmod 600 "$B/private"/*
cd "$R"
sudo -n docker build -q -t "$T" . >/dev/null
ln -sfn "$R" "$B/current"
cd "$B/current" && sudo -n docker compose up -d --no-build
for i in $(seq 1 24); do sleep 5; h=$(sudo -n docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' judoju-news-read-gateway-1 2>/dev/null || true); [ "$h" = healthy ] && { echo "HEALTHY image=$T"; exit 0; }; done
echo NOT_HEALTHY; sudo -n docker logs --tail 20 judoju-news-read-gateway-1 2>&1 | cut -c1-300; exit 3
'@
Invoke-Remote ($deploy.Replace('__REMOTE__', $remote).Replace('__BASE__', $base).Replace('__COMMIT__', $commit))
Invoke-Remote $statusScript

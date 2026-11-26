# AI processor operations on the AWS worker: deploy | status | stop.
# deploy: packages the committed AI runtime sources (git archive of HEAD), builds an image on top of the running
#         collector image (same Node and dependencies), uploads the server config and the API key file
#         (never printed), and starts the "judoju-news-ai" compose project with JUDOJU_AI_EXECUTE=0 unless -Execute.
# status: container health and the service's status.json (counts only, no URLs).
param([Parameter(Mandatory = $true)][ValidateSet('deploy', 'status', 'stop')][string]$Command, [switch]$Execute)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$keys = Join-Path $repo '.local-data\collector-cloud\ssh-lightsail'
$server = 'ubuntu@52.79.247.25'; $base = '/home/ubuntu/.local/share/judoju-ai'; $collector = 'judoju-news-html-collector-collector-1'
$ssh = @('-i', "$keys\judoju-collector-ed25519", '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', "UserKnownHostsFile=$keys\known_hosts_lightsail",
  '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'HostKeyAlgorithms=ssh-ed25519')
function Invoke-Remote([string]$script) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($script -replace "`r", '')))
  $output = ssh.exe @ssh $server "echo $encoded | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) { $output; throw "Remote step failed (exit $LASTEXITCODE)" }
  return $output
}
$statusScript = @'
c=judoju-news-ai-processor-1
sudo -n docker inspect --format 'image={{.Config.Image}} running={{.State.Running}} health={{if .State.Health}}{{.State.Health.Status}}{{end}} restarts={{.RestartCount}}' $c
sudo -n docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $c | grep -E '^JUDOJU_AI_EXECUTE='
sudo -n docker logs --since 15m $c 2>&1 | grep -oE '"event":"[A-Z_]+"|"state":"[A-Z_]+"|"reason":"[A-Z_]+"' | sort | uniq -c | tr -s ' ' | paste -sd ',' -
sudo -n docker exec $c node -e "const s=JSON.parse(require('node:fs').readFileSync('/ai/status.json','utf8'));console.log(JSON.stringify({at:new Date(s.at).toISOString(),execute:s.execute,jobs:s.jobs,documents:s.documents,drafts:s.drafts,newsSignals:s.newsSignals.links,accessReviewHosts:s.accessReviewHosts.length,modelRuns:s.modelRuns}))"
'@
if ($Command -eq 'status') { Invoke-Remote $statusScript; return }
if ($Command -eq 'stop') { Invoke-Remote "cd $base/current && sudo -n docker compose stop processor"; return }

$dirty = git -C $repo status --porcelain -- workers/ai-processing packages/contracts/src workers/collectors/src data/dart-corp-codes.tsv
if ($dirty) { throw 'AI runtime sources have uncommitted changes; commit first.' }
$config = Join-Path $repo '.local-data\ai\config.json'; $key = Join-Path $repo '.local-data\ai\openai.key'; $dartKey = Join-Path $repo '.local-data\dart\opendart.key'
foreach ($file in $config, $key, $dartKey) { if (-not (Test-Path $file)) { throw "Missing $file" } }
$commit = (git -C $repo rev-parse --short HEAD).Trim()
$stage = Join-Path $env:TEMP "judoju-ai-$commit"; Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $stage | Out-Null
git -C $repo archive --format=tar -o (Join-Path $stage 'runtime.tar') HEAD workers/ai-processing/runtime workers/ai-processing/src workers/collectors/src packages/contracts/src data/dart-corp-codes.tsv
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
$baseImage = (Invoke-Remote "sudo -n docker inspect --format '{{.Config.Image}}' $collector").Trim()
if ($baseImage -notmatch '^judoju-news-html-collector:[A-Za-z0-9._-]+$') { throw "Unexpected collector image: $baseImage" }
@"
FROM $baseImage
LABEL com.judoju.product="judoju-news" com.judoju.component="ai-processor" com.judoju.source-commit="$commit"
USER root
ADD runtime.tar /opt/judoju/
RUN install -d -o node -g node /ai
USER node
CMD ["node", "--experimental-strip-types", "workers/ai-processing/runtime/service.mjs"]
"@ | Set-Content "$stage\Dockerfile" -Encoding ascii
$executeFlag = if ($Execute) { '1' } else { '0' }
@"
name: judoju-news-ai
services:
  processor:
    image: judoju-news-ai-processor:$commit
    init: true
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    restart: unless-stopped
    environment:
      JUDOJU_AI_EXECUTE: "$executeFlag"
      JUDOJU_AI_CONFIG: /ai-config/config.json
    volumes:
      - ai:/ai
      - collector:/collector
      - $base/config/config.json:/ai-config/config.json:ro
      - $base/secrets/openai.key:/run/secrets/openai.key:ro
      - $base/secrets/opendart.key:/run/secrets/opendart.key:ro
    tmpfs: [/tmp]
    healthcheck:
      test: ["CMD", "node", "-e", "const t=Number(require('node:fs').readFileSync('/ai/heartbeat','utf8')); if(!t||Date.now()-t>180000)process.exit(1)"]
      interval: 30s
      timeout: 5s
      retries: 4
    stop_grace_period: 30s
volumes:
  ai:
    labels:
      com.judoju.product: judoju-news
  collector:
    external: true
    name: judoju-news-html-collector_candidates
"@ | Set-Content "$stage\compose.yaml" -Encoding ascii
$remote = (ssh.exe @ssh $server "install -d -m 700 $base $base/secrets $base/config && mktemp -d $base/release-$commit.XXXXXXXX").Trim()
if ($remote -notmatch "^$([regex]::Escape($base))/release-$commit\.[A-Za-z0-9]{8}$") { throw "Unexpected remote dir: $remote" }
scp.exe @ssh "$stage\runtime.tar" "$stage\Dockerfile" "$stage\compose.yaml" "${server}:$remote/"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed' }
# Config and key go to fixed private paths (mode 600); the key is copied as a file and never printed.
scp.exe @ssh $config "${server}:$base/config/config.json"; if ($LASTEXITCODE -ne 0) { throw 'Config upload failed' }
scp.exe @ssh $key "${server}:$base/secrets/openai.key"; if ($LASTEXITCODE -ne 0) { throw 'Key upload failed' }
scp.exe @ssh $dartKey "${server}:$base/secrets/opendart.key"; if ($LASTEXITCODE -ne 0) { throw 'DART key upload failed' }
$deploy = @'
set -euo pipefail
R=__REMOTE__; B=__BASE__; T=judoju-news-ai-processor:__COMMIT__
chmod 600 "$B/secrets/openai.key" "$B/secrets/opendart.key"; chmod 644 "$B/config/config.json"; chmod 711 "$B" "$B/config"; chmod 711 "$B/secrets"
cd "$R"
sudo -n docker build -q -t "$T" . >/dev/null
sudo -n docker run --rm --network none --read-only --entrypoint node "$T" --experimental-strip-types --input-type=module -e "await import('/opt/judoju/workers/ai-processing/runtime/service.mjs'); await import('/opt/judoju/workers/ai-processing/runtime/cli.mjs'); console.log('IMPORT_OK')"
ln -sfn "$R" "$B/current"
cd "$B/current" && sudo -n docker compose up -d --no-build processor
for i in $(seq 1 24); do sleep 5; h=$(sudo -n docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' judoju-news-ai-processor-1 2>/dev/null || true); [ "$h" = healthy ] && { echo "HEALTHY image=$T"; exit 0; }; done
echo NOT_HEALTHY; sudo -n docker logs --tail 20 judoju-news-ai-processor-1 2>&1 | cut -c1-300; exit 3
'@
Invoke-Remote ($deploy.Replace('__REMOTE__', $remote).Replace('__BASE__', $base).Replace('__COMMIT__', $commit))
Invoke-Remote $statusScript

# CLOUD11-online admin on the AWS worker: store-secret | deploy | status | revoke.
# store-secret: hidden prompt for the Supabase secret key (sb_secret_...) -> .local-data\admin-online\secret.key (never printed).
# deploy: builds the admin (Next standalone) and the session broker on the server from the committed sources, writes the two
#         private configs (owner-only, uid 1000; the secret key only in the broker's), starts "judoju-news-admin" and adds
#         the admin site to Caddy (https://admin.52-79-247-25.sslip.io). Does NOT activate DB permissions (activation.sql).
# revoke: the single ordered emergency procedure (docs/cloud/cloud11-online-admin-plan.md H6):
#         runs from this PC with the local secret key: 1 DB block (DB-confirmed) -> 2 end admin Auth sessions -> 3 stop and
#         delete on the server (each part checked) -> 4 final DB check; receipt per run; any unconfirmed step exits 1.
param([Parameter(Mandatory = $true)][ValidateSet('store-secret', 'deploy', 'status', 'revoke')][string]$Command)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$local = Join-Path $repo '.local-data\admin-online'
$keys = Join-Path $repo '.local-data\collector-cloud\ssh-lightsail'
$server = 'ubuntu@52.79.247.25'; $base = '/home/ubuntu/.local/share/judoju-admin'; $readBase = '/home/ubuntu/.local/share/judoju-read'
$hostName = 'admin.52-79-247-25.sslip.io'; $api = 'https://nxfpfvsdwbziowkxsxnh.supabase.co'
$owner = 'e85049b7-7306-42ad-ac16-6c4bf5e82212'; $ownerEmailSha = '7bd88947e82eccad28360716d82f516c01b90733dd82ba1fe3bce5ba50c36f8d'
$ssh = @('-i', "$keys\judoju-collector-ed25519", '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', "UserKnownHostsFile=$keys\known_hosts_lightsail",
  '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'HostKeyAlgorithms=ssh-ed25519')
function Invoke-Remote([string]$script) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($script -replace "`r", '')))
  $output = ssh.exe @ssh $server "echo $encoded | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) { $output; throw "Remote step failed (exit $LASTEXITCODE)" }
  return $output
}
New-Item -ItemType Directory -Force $local | Out-Null

if ($Command -eq 'store-secret') {
  $secure = Read-Host 'Supabase secret key (input hidden)' -AsSecureString
  $key = ([System.Net.NetworkCredential]::new('', $secure).Password -replace '[​-‍﻿\s]', '').Trim('"', "'")
  if ($key -notmatch '^sb_secret_[A-Za-z0-9_-]{16,256}$') { throw "Not a secret key (expected sb_secret_..., length $($key.Length)). Nothing was saved." }
  [System.IO.File]::WriteAllText((Join-Path $local 'secret.key'), $key); Write-Host 'Saved .local-data\admin-online\secret.key (not printed).'; return
}

$statusScript = @'
for c in judoju-news-admin-admin-1 judoju-news-admin-broker-1; do
  sudo -n docker inspect --format "$c running={{.State.Running}} health={{if .State.Health}}{{.State.Health.Status}}{{end}} restarts={{.RestartCount}} image={{.Config.Image}}" $c 2>/dev/null || echo "$c missing"
done
curl -s -m 10 -o /dev/null -w 'https_admin=%{http_code}\n' https://__HOST__/login || echo 'https_admin=unreachable'
'@.Replace('__HOST__', $hostName)
if ($Command -eq 'status') { Invoke-Remote $statusScript; return }

if ($Command -eq 'revoke') {
  # Authoritative order (plan H6). Runs from this PC with the locally stored secret key, so it works even when the
  # server, the broker or the admin is down. Each step goes into a local receipt; any step not confirmed stops the run
  # with an error (exit code 1) and says what to do.
  $receipt = [ordered]@{ startedAt = (Get-Date).ToUniversalTime().ToString('o'); steps = [ordered]@{} }
  $receiptFile = Join-Path $local ('revoke-receipt-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
  function Save-Receipt { $receipt | ConvertTo-Json -Depth 6 | Set-Content $receiptFile -Encoding utf8 }
  function Stop-Revoke([string]$step, [string]$advice) { $receipt.stoppedAt = $step; Save-Receipt; Write-Host "$step NOT CONFIRMED. $advice Receipt: $receiptFile"; throw "REVOKE_${step}_UNCONFIRMED" }
  $secretPath = Join-Path $local 'secret.key'
  $secret = if (Test-Path $secretPath) { (Get-Content $secretPath -Raw).Trim() } else { '' }
  function Invoke-AdminFn([string]$fn) {
    if (-not $secret) { return @{ error = 'NO_LOCAL_SECRET_KEY' } }
    try { return @{ body = (Invoke-RestMethod -Method Post -Uri "$api/rest/v1/rpc/$fn" -Headers @{ apikey = $secret } -ContentType 'application/json' -Body '{}' -TimeoutSec 20) } }
    catch { return @{ error = [string]$_.Exception.Message } }
  }
  $zero = { param($b) $b -and $b.editorGrants -eq 0 -and $b.sessionGrants -eq 0 -and $b.activeMemberships -eq 0 -and $b.openSessions -eq 0 }
  # 1. DB block, confirmed by the DB's own status.
  $r1 = Invoke-AdminFn 'admin_online_revoke'
  $ok1 = $r1.body -and $r1.body.revoked -eq $true -and (& $zero $r1.body)
  $receipt.steps.dbBlock = @{ confirmed = [bool]$ok1; result = $r1 }; Save-Receipt
  if (-not $ok1) { Stop-Revoke 'STEP1' 'In the Supabase SQL Editor run: select public.admin_online_revoke(); and check every count is 0, then also run: select public.admin_online_signout(); (steps 3-4 can then be re-run with this command once the key works).' }
  # 2. End every Auth session of admin users (refresh tokens cascade).
  $r2 = Invoke-AdminFn 'admin_online_signout'
  $ok2 = $r2.body -and $null -ne $r2.body.authSessionsEnded
  $receipt.steps.authSignout = @{ confirmed = [bool]$ok2; result = $r2 }; Save-Receipt
  if (-not $ok2) { Stop-Revoke 'STEP2' 'The DB block stands. In the SQL Editor run: select public.admin_online_signout(); then re-run revoke.' }
  # 3. Stop the containers, remove the private configs and the Caddy site; every part is checked on the server.
  $teardown = @'
set -u
cd __BASE__/current 2>/dev/null && sudo -n docker compose down >/dev/null 2>&1
running=$(sudo -n docker ps -q --filter name=judoju-news-admin- | wc -l); echo "containers_running=$running"
sudo -n rm -rf __BASE__/private; test -e __BASE__/private && echo private=present || echo private=removed
sudo -n rm -f __READBASE__/sites/admin.caddy; test -e __READBASE__/sites/admin.caddy && echo site=present || echo site=removed
sudo -n docker exec judoju-news-read-proxy-1 caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 && echo caddy=reloaded || echo caddy=reload_failed
code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' https://__HOST__/login || true); echo "admin_https=$code"
'@.Replace('__BASE__', $base).Replace('__READBASE__', $readBase).Replace('__HOST__', $hostName)
  $t = ''; try { $t = (Invoke-Remote $teardown) -join "`n" } catch { $t = 'SSH_FAILED ' + $_.Exception.Message }
  $ok3 = $t -match 'containers_running=0' -and $t -match 'private=removed' -and $t -match 'site=removed' -and $t -match 'caddy=reloaded' -and $t -notmatch 'admin_https=200'
  $receipt.steps.stopAndDelete = @{ confirmed = [bool]$ok3; output = $t }; Save-Receipt
  if (-not $ok3) { Stop-Revoke 'STEP3' 'DB block and sign-out stand. Check the server (status command) and re-run revoke; if the server is unreachable, stop the instance in the Lightsail console.' }
  # 4. Final check: the DB reports no authority and no admin Auth session left.
  $r4 = Invoke-AdminFn 'admin_online_status'
  $ok4 = (& $zero $r4.body) -and $r4.body.adminAuthSessions -eq 0
  $receipt.steps.finalCheck = @{ confirmed = [bool]$ok4; result = $r4 }; $receipt.finishedAt = (Get-Date).ToUniversalTime().ToString('o'); Save-Receipt
  if (-not $ok4) { Stop-Revoke 'STEP4' 'Something re-granted authority or a session reappeared. Run select public.admin_online_status(); in the SQL Editor and investigate before anything else.' }
  Write-Host "Revoke confirmed (all four steps). Receipt: $receiptFile"
  Write-Host 'Now delete the secret key "judoju-admin-broker" in Supabase > Project Settings > API Keys. Re-enabling later needs a new key, activation.sql and deploy.'
  return
}


# deploy
$sources = @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.node-version', 'apps/admin', 'packages/contracts', 'scripts/admin-broker.mjs')
$dirty = git -C $repo status --porcelain -- @sources
if ($dirty) { throw 'Admin sources have uncommitted changes; commit first.' }
$secretFile = Join-Path $local 'secret.key'; $publishableFile = Join-Path $repo '.local-data\cloud-preview\publishable.key'
foreach ($f in $secretFile, $publishableFile) { if (-not (Test-Path $f)) { throw "Missing $f" } }
# Encryption and IPC keys are generated once and kept locally (git-ignored); never printed.
$keysFile = Join-Path $local 'keys.json'
if (-not (Test-Path $keysFile)) {
  $rand = { $b = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Fill($b); ($b | ForEach-Object { $_.ToString('x2') }) -join '' }
  @{ encryptionKey = (& $rand); ipcKey = (& $rand) } | ConvertTo-Json | Set-Content $keysFile -Encoding ascii
}
$k = Get-Content $keysFile -Raw | ConvertFrom-Json
$commit = (git -C $repo rev-parse --short HEAD).Trim()
$stage = Join-Path $env:TEMP "judoju-admin-$commit"; Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $stage | Out-Null
$manifests = git -C $repo ls-files -- 'apps/*/package.json' 'packages/*/package.json' 'workers/*/package.json'
git -C $repo archive --format=tar -o (Join-Path $stage 'source.tar') HEAD @sources @manifests
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
$sock = '/run/judoju-broker/broker.sock'
[ordered]@{ apiUrl = $api; brokerSocket = $sock; encryptionKey = $k.encryptionKey; ipcKey = $k.ipcKey; origin = "https://$hostName"; ownerEmailSha256 = $ownerEmailSha;
  ownerUserId = $owner; projectRef = 'nxfpfvsdwbziowkxsxnh'; publishableKey = (Get-Content $publishableFile -Raw).Trim() } | ConvertTo-Json | Set-Content "$stage\admin-config.json" -Encoding ascii
[ordered]@{ apiUrl = $api; ipcKey = $k.ipcKey; ownerUserId = $owner; publishableKey = (Get-Content $publishableFile -Raw).Trim(); secretKey = (Get-Content $secretFile -Raw).Trim(); socketPath = $sock } |
  ConvertTo-Json | Set-Content "$stage\broker-config.json" -Encoding ascii
@'
FROM node:24.15.0-bookworm-slim AS build
WORKDIR /src
ADD source.tar /src/
RUN corepack enable && pnpm install --frozen-lockfile --filter @judoju/admin... && JUDOJU_ADMIN_STANDALONE=1 pnpm --filter @judoju/admin build
FROM node:24.15.0-bookworm-slim AS admin
WORKDIR /app
COPY --from=build --chown=node:node /src/apps/admin/.next/standalone /app
COPY --from=build --chown=node:node /src/apps/admin/.next/static /app/apps/admin/.next/static
RUN install -d -o node -g node /run/judoju-broker /data/admin-online /app/apps/admin/.next/cache
USER node
ENV NODE_ENV=production JUDOJU_ADMIN_PROFILE=online HOSTNAME=127.0.0.1 PORT=62333 JUDOJU_ADMIN_ONLINE_CONFIG=/opt/judoju/.local-data/admin-online/config.json JUDOJU_ADMIN_ONLINE_STATE=/data/admin-online/limits.json
CMD ["node", "apps/admin/server.js"]
FROM node:24.15.0-bookworm-slim AS broker
WORKDIR /opt/judoju
COPY --from=build --chown=node:node /src/scripts/admin-broker.mjs /opt/judoju/scripts/admin-broker.mjs
RUN install -d -o node -g node /run/judoju-broker
USER node
CMD ["node", "scripts/admin-broker.mjs"]
'@ | Set-Content "$stage\Dockerfile" -Encoding ascii
@"
name: judoju-news-admin
services:
  broker:
    image: judoju-news-admin-broker:$commit
    init: true
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    restart: unless-stopped
    volumes:
      - broker_sock:/run/judoju-broker
      - $base/private/broker:/opt/judoju/.local-data/admin-broker:ro
    tmpfs: [/tmp]
  admin:
    image: judoju-news-admin-web:$commit
    init: true
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    network_mode: host
    restart: unless-stopped
    depends_on: [broker]
    volumes:
      - broker_sock:/run/judoju-broker
      - admin_state:/data/admin-online
      - $base/private/admin:/opt/judoju/.local-data/admin-online:ro
    tmpfs: [/tmp, /app/apps/admin/.next/cache]
volumes:
  broker_sock: {}
  admin_state: {}
"@ | Set-Content "$stage\compose.yaml" -Encoding ascii
@"
$hostName {
	header {
		-Server
		Strict-Transport-Security "max-age=31536000"
		X-Frame-Options "DENY"
		Referrer-Policy "no-referrer"
		X-Content-Type-Options "nosniff"
		Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
	}
	reverse_proxy 127.0.0.1:62333 {
		header_up X-Forwarded-For {remote_host}
	}
}
"@ | Set-Content "$stage\admin.caddy" -Encoding ascii
$remote = (ssh.exe @ssh $server "install -d -m 700 $base && mktemp -d $base/release-$commit.XXXXXXXX").Trim()
if ($remote -notmatch "^$([regex]::Escape($base))/release-$commit\.[A-Za-z0-9]{8}$") { throw "Unexpected remote dir: $remote" }
scp.exe @ssh "$stage\source.tar" "$stage\Dockerfile" "$stage\compose.yaml" "$stage\admin.caddy" "$stage\admin-config.json" "$stage\broker-config.json" "${server}:$remote/"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed' }
Remove-Item "$stage\admin-config.json", "$stage\broker-config.json" -Force
$deploy = @'
set -euo pipefail
R=__REMOTE__; B=__BASE__; RB=__READBASE__; C=__COMMIT__
sudo -n install -d -m 700 -o 1000 -g 1000 "$B/private" "$B/private/admin" "$B/private/broker"
sudo -n install -m 600 -o 1000 -g 1000 "$R/admin-config.json" "$B/private/admin/config.json"
sudo -n install -m 600 -o 1000 -g 1000 "$R/broker-config.json" "$B/private/broker/config.json"
rm -f "$R/admin-config.json" "$R/broker-config.json"
cd "$R"
sudo -n docker build -q --target admin -t "judoju-news-admin-web:$C" . >/dev/null
sudo -n docker build -q --target broker -t "judoju-news-admin-broker:$C" . >/dev/null
ln -sfn "$R" "$B/current"
cd "$B/current" && sudo -n docker compose up -d --no-build
# The public site is added only after the admin answered locally; otherwise the deploy fails and nothing is exposed.
up=0
for i in $(seq 1 24); do sleep 5; s=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: __HOST__' http://127.0.0.1:62333/login || true); [ "$s" = 200 ] && { up=1; echo "ADMIN_UP image=$C"; break; }; done
if [ "$up" != 1 ]; then echo "ADMIN_NOT_READY image=$C"; sudo -n docker compose logs --tail 30 admin broker 2>&1 | sed -E 's/(sb_[a-z]+_)[A-Za-z0-9_-]+/\1REDACTED/g' || true; exit 1; fi
sudo -n install -d -m 755 "$RB/sites" && sudo -n install -m 644 "$R/admin.caddy" "$RB/sites/admin.caddy"
sudo -n docker exec judoju-news-read-proxy-1 caddy reload --config /etc/caddy/Caddyfile >/dev/null && echo CADDY_RELOADED
code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' https://__HOST__/login || true)
[ "$code" = 200 ] || { echo "ADMIN_HTTPS_NOT_READY code=$code"; exit 1; }
echo "ADMIN_HTTPS_UP"
'@
Invoke-Remote ($deploy.Replace('__REMOTE__', $remote).Replace('__BASE__', $base).Replace('__READBASE__', $readBase).Replace('__COMMIT__', $commit).Replace('__HOST__', $hostName))
Invoke-Remote $statusScript

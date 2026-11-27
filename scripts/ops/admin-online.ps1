# CLOUD11-online admin on the AWS worker: store-secret | deploy | status | revoke.
# store-secret: hidden prompt for the Supabase secret key (sb_secret_...) -> .local-data\admin-online\secret.key (never printed).
# deploy: builds the admin (Next standalone) and the session broker on the server from the committed sources, writes the two
#         private configs (owner-only, uid 1000; the secret key only in the broker's), starts "judoju-news-admin" and adds
#         the admin site to Caddy (https://admin.52-79-247-25.sslip.io). Does NOT activate DB permissions (activation.sql).
# revoke: the single ordered emergency procedure (docs/cloud/cloud11-online-admin-plan.md H6):
#         1 DB block confirmed by admin_online_status -> 2 end admin Auth sessions -> 3 stop and delete -> 4 final check from this PC; receipts.
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
  # Authoritative order (plan H6). Each step's result goes into a local receipt; a step that cannot be confirmed stops the run.
  $receipt = [ordered]@{ startedAt = (Get-Date).ToUniversalTime().ToString('o'); steps = [ordered]@{} }
  $receiptFile = Join-Path $local ('revoke-receipt-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
  function Save-Receipt { $receipt | ConvertTo-Json -Depth 6 | Set-Content $receiptFile -Encoding utf8 }
  $inBroker = @'
sudo -n docker exec -i judoju-news-admin-broker-1 node --input-type=module - <<'JS'
import { readFileSync } from 'node:fs';
const c = JSON.parse(readFileSync('/opt/judoju/.local-data/admin-broker/config.json', 'utf8'));
const r = await fetch(c.apiUrl + '/rest/v1/rpc/__FN__', { method: 'POST', headers: { apikey: c.secretKey, 'Content-Type': 'application/json' }, body: '{}' });
console.log('RESULT ' + JSON.stringify({ status: r.status, body: await r.json().catch(() => null) }));
JS
'@
  function Invoke-BrokerFn([string]$fn) { $out = Invoke-Remote $inBroker.Replace('__FN__', $fn); $line = ($out | Where-Object { $_ -like 'RESULT *' } | Select-Object -Last 1); if (-not $line) { return $null }; return ($line.Substring(7) | ConvertFrom-Json) }
  # 1. DB block, confirmed by the DB's own status (all grants, memberships and open sessions zero).
  $r1 = $null; try { $r1 = Invoke-BrokerFn 'admin_online_revoke' } catch {}
  $ok1 = $r1 -and $r1.status -eq 200 -and $r1.body.revoked -eq $true -and $r1.body.editorGrants -eq 0 -and $r1.body.sessionGrants -eq 0 -and $r1.body.activeMemberships -eq 0 -and $r1.body.openSessions -eq 0
  $receipt.steps.dbBlock = @{ confirmed = [bool]$ok1; result = $r1 }; Save-Receipt
  if (-not $ok1) { Write-Host "STEP 1 NOT CONFIRMED. Run in the Supabase SQL Editor: select public.admin_online_revoke(); then re-run revoke. Receipt: $receiptFile"; throw 'REVOKE_STEP1_UNCONFIRMED' }
  # 2. End every Auth session of admin users (refresh tokens cascade). Separate HTTP step; stops if not confirmed.
  $r2 = $null; try { $r2 = Invoke-BrokerFn 'admin_online_signout' } catch {}
  $ok2 = $r2 -and $r2.status -eq 200 -and $null -ne $r2.body.authSessionsEnded
  $receipt.steps.authSignout = @{ confirmed = [bool]$ok2; result = $r2 }; Save-Receipt
  if (-not $ok2) { Write-Host "STEP 2 NOT CONFIRMED (DB block stands). Run in the SQL Editor: select public.admin_online_signout(); then re-run revoke. Receipt: $receiptFile"; throw 'REVOKE_STEP2_UNCONFIRMED' }
  # 3. Stop the containers, remove the private configs and the Caddy site.
  $r3 = Invoke-Remote "cd $base/current 2>/dev/null && sudo -n docker compose down >/dev/null 2>&1; sudo -n rm -rf $base/private; sudo -n rm -f $readBase/sites/admin.caddy; sudo -n docker exec judoju-news-read-proxy-1 caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1; test ! -e $base/private && echo REMOVED"
  $receipt.steps.stopAndDelete = @{ confirmed = [bool]($r3 -match 'REMOVED') }; Save-Receipt
  # 4. Final check from this PC with the local secret key: the DB reports no authority left.
  $secret = (Get-Content (Join-Path $local 'secret.key') -Raw).Trim()
  try { $s = Invoke-RestMethod -Method Post -Uri "$api/rest/v1/rpc/admin_online_status" -Headers @{ apikey = $secret } -ContentType 'application/json' -Body '{}' } catch { $s = $null }
  $ok4 = $s -and $s.editorGrants -eq 0 -and $s.sessionGrants -eq 0 -and $s.activeMemberships -eq 0 -and $s.openSessions -eq 0 -and $s.adminAuthSessions -eq 0
  $receipt.steps.finalCheck = @{ confirmed = [bool]$ok4; result = $s }; $receipt.finishedAt = (Get-Date).ToUniversalTime().ToString('o'); Save-Receipt
  Write-Host "Revoke receipt: $receiptFile (final check confirmed: $([bool]$ok4))"
  Write-Host 'Delete the secret key "judoju-admin-broker" in Supabase > Project Settings > API Keys. To re-enable later, re-run activation.sql (it accepts the revoked state) and deploy.'
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
sudo -n install -d -m 755 "$RB/sites" && sudo -n install -m 644 "$R/admin.caddy" "$RB/sites/admin.caddy"
for i in $(seq 1 24); do sleep 5; s=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: __HOST__' http://127.0.0.1:62333/login || true); [ "$s" = 200 ] && { echo "ADMIN_UP image=$C"; break; }; done
sudo -n docker exec judoju-news-read-proxy-1 caddy reload --config /etc/caddy/Caddyfile >/dev/null && echo CADDY_RELOADED
'@
Invoke-Remote ($deploy.Replace('__REMOTE__', $remote).Replace('__BASE__', $base).Replace('__READBASE__', $readBase).Replace('__COMMIT__', $commit).Replace('__HOST__', $hostName))
Invoke-Remote $statusScript

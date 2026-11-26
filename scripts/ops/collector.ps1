# Collector operations on the AWS Lightsail worker: status, deploy, rollback.
# Usage (from the repo root):  pwsh scripts/ops/collector.ps1 status|deploy|rollback
# - status   : read-only health, image, flags, recent cycle results and stored-link counts.
# - deploy   : derived image = running image + changed scripts/providers/*.mjs (by hash), offline import check,
#              web DB backup, swap, health wait; automatic rollback if it is not healthy within 2 minutes.
# - rollback : return to the compose files recorded by the latest deploy.
# The SSH key stays in .local-data (git-ignored). Key contents are never printed.
param([Parameter(Mandatory = $true)][ValidateSet('status', 'deploy', 'rollback')][string]$Command)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$keys = Join-Path $repo '.local-data\collector-cloud\ssh-lightsail'
$server = 'ubuntu@52.79.247.25'
$container = 'judoju-news-html-collector-collector-1'
$base = '/home/ubuntu/.local/share/judoju-collector'
if (-not (Test-Path "$keys\judoju-collector-ed25519")) { throw "SSH key folder not found: $keys" }
$ssh = @('-i', "$keys\judoju-collector-ed25519", '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', "UserKnownHostsFile=$keys\known_hosts_lightsail",
  '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'HostKeyAlgorithms=ssh-ed25519')

function Invoke-Remote([string]$script) {
  # Piping text into a native command adds CRLF line endings on Windows; send the script base64-encoded instead.
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($script -replace "`r", '')))
  $output = ssh.exe @ssh $server "echo $encoded | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) { $output; throw "Remote step failed (exit $LASTEXITCODE)" }
  return $output
}

$statusScript = @'
set -euo pipefail
c=__CONTAINER__
sudo -n docker inspect --format 'image={{.Config.Image}} running={{.State.Running}} health={{if .State.Health}}{{.State.Health.Status}}{{end}} restarts={{.RestartCount}} started={{.State.StartedAt}}' $c
sudo -n docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $c | grep -E '^JUDOJU_(PUBLIC_WATCH|TELEGRAM_LINKS)='
echo "errors_10m=$(sudo -n docker logs --since 10m $c 2>&1 | grep -ciE 'error|failed' || true)"
sudo -n docker logs --since 10m $c 2>&1 | grep -oE '"status":"[A-Z_]+"' | sort | uniq -c | tr -s ' ' | sed 's/^ //' | paste -sd ',' - | sed 's/^/statuses_10m=/'
sudo -n docker exec -i $c node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite'; import { existsSync } from 'node:fs';
const out = {}; const now = Date.now();
if (existsSync('/data/telegram-links.sqlite')) {
  const t = new DatabaseSync('/data/telegram-links.sqlite', { readOnly: true });
  out.telegramUniqueLinks = t.prepare('SELECT count(DISTINCT url) n FROM telegram_page_links WHERE expires_at > ?').get(now).n;
  out.telegramNewLinks24h = t.prepare('SELECT count(*) n FROM telegram_page_links WHERE last_seen > ?').get(now - 86400000).n;
  out.telegramChannelsSeen = t.prepare('SELECT count(*) n FROM telegram_page_diagnostics').get().n;
  out.telegramLastStatus = Object.fromEntries(t.prepare('SELECT status, count(*) n FROM telegram_page_diagnostics GROUP BY status').all().map(r => [r.status, r.n]));
  t.close();
}
const w = new DatabaseSync('/data/collection.sqlite', { readOnly: true });
const tables = w.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(r => r.name);
if (tables.includes('candidates')) out.webCandidates = w.prepare('SELECT count(*) n FROM candidates WHERE expires_at > ?').get(now).n;
w.close();
console.log(JSON.stringify(out));"
'@.Replace('__CONTAINER__', $container)

if ($Command -eq 'status') { Invoke-Remote $statusScript; return }

if ($Command -eq 'rollback') {
  $script = @'
set -euo pipefail
# The newest release that recorded a rollback point (a failed upload/build leaves a folder without one).
R=$(ls -1dt __BASE__/release-*/previous-compose.txt 2>/dev/null | head -1 | xargs -r dirname)
test -n "$R" && test -f "$R/previous-compose.txt"
mapfile -t files < "$R/previous-compose.txt"
args=(); for f in "${files[@]}"; do args+=(-f "$f"); done
cd __BASE__/release/workers/collectors
sudo -n docker compose "${args[@]}" up -d --no-build collector
echo "ROLLED_BACK_FROM=$R"
'@
  Invoke-Remote ($script.Replace('__BASE__', $base)); Start-Sleep -Seconds 20; Invoke-Remote $statusScript; return
}

# deploy
$dirty = git -C $repo status --porcelain -- scripts/providers
if ($dirty) { throw "scripts/providers has uncommitted changes; commit first." }
$commit = (git -C $repo rev-parse --short HEAD).Trim()
$current = Invoke-Remote @"
sudo -n docker inspect --format '{{.Config.Image}}' $container
sudo -n docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' $container
sudo -n docker run --rm --network none --entrypoint sh `$(sudo -n docker inspect --format '{{.Config.Image}}' $container) -c 'cd /opt/judoju/scripts/providers && sha256sum *.mjs'
"@
$baseImage = $current[0].Trim(); $composeFiles = $current[1].Trim().Split(',')
# Values read from the server go into a generated shell script: accept only plain collector paths and image tags.
foreach ($file in $composeFiles) {
  if ($file -notmatch "^$([regex]::Escape($base))/[A-Za-z0-9._/-]+\.yaml$" -or $file -match '\.\.') { throw "Unexpected compose file path: $file" }
}
if ($baseImage -notmatch '^judoju-news-html-collector:[A-Za-z0-9._-]+$') { throw "Unexpected base image: $baseImage" }
$remoteHashes = @{}; foreach ($line in $current[2..($current.Count - 1)]) { $parts = $line.Trim() -split '\s+'; if ($parts.Count -eq 2) { $remoteHashes[$parts[1]] = $parts[0] } }
# Only modules the worker actually loads: html-worker.mjs and its local import chain (plus the release check).
$providers = Join-Path $repo 'scripts\providers'
$needed = [System.Collections.Generic.HashSet[string]]::new(); $queue = [System.Collections.Generic.Queue[string]]::new()
foreach ($entry in 'html-worker.mjs', 'telegram-release-check.mjs') { [void]$needed.Add($entry); $queue.Enqueue($entry) }
while ($queue.Count) {
  $file = $queue.Dequeue()
  foreach ($match in [regex]::Matches((Get-Content (Join-Path $providers $file) -Raw), "from\s+'\./([a-z0-9-]+\.mjs)'")) {
    if ($needed.Add($match.Groups[1].Value)) { $queue.Enqueue($match.Groups[1].Value) }
  }
}
$changed = $needed | Sort-Object | Where-Object { $remoteHashes[$_] -ne (Get-FileHash (Join-Path $providers $_) -Algorithm SHA256).Hash.ToLower() }
if (-not $changed) { "NOTHING_TO_DEPLOY: running image $baseImage already matches scripts/providers at $commit"; return }
"BASE_IMAGE=$baseImage"; "CHANGED=$($changed -join ',')"
$tag = "judoju-news-html-collector:release-$commit"
$stage = Join-Path $env:TEMP "judoju-release-$commit"; Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue; New-Item -ItemType Directory $stage | Out-Null
foreach ($name in $changed) { Copy-Item (Join-Path $repo "scripts\providers\$name") (Join-Path $stage $name) }
"FROM $baseImage`nLABEL com.judoju.source-commit=`"$commit`"`nCOPY $($changed -join ' ') /opt/judoju/scripts/providers/`n" | Set-Content "$stage\Dockerfile" -Encoding ascii -NoNewline
(Get-ChildItem $stage -File | Get-FileHash -Algorithm SHA256 | ForEach-Object { $_.Hash.ToLower() + '  ' + (Split-Path $_.Path -Leaf) }) | Set-Content "$stage\source-sha256.txt" -Encoding ascii
$remote = (ssh.exe @ssh $server "mktemp -d $base/release-$commit.XXXXXXXX").Trim()
if ($remote -notmatch "^$([regex]::Escape($base))/release-$commit\.[A-Za-z0-9]{8}$") { throw "Unexpected remote release dir: $remote" }
scp.exe @ssh (Get-ChildItem $stage -File | ForEach-Object FullName) "${server}:$remote/"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed' }
# Keep the earlier compose files, drop earlier generated release overrides, then add this release's override.
$keep = $composeFiles | Where-Object { $_ -notmatch '/compose\.(pacing|newonly|release)\.yaml$' }
$deploy = @'
set -euo pipefail
R=__REMOTE__; C=__CONTAINER__; T=__TAG__
cd "$R"; sha256sum -c --quiet source-sha256.txt
sudo -n docker build -q -t "$T" . >/dev/null
sudo -n docker run --rm --network none --read-only --entrypoint node "$T" --input-type=module -e "await import('/opt/judoju/scripts/providers/html-worker.mjs'); await import('/opt/judoju/scripts/providers/telegram-link-worker.mjs'); console.log('IMPORT_OK')"
telegram=$(sudo -n docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' $C | sed -n 's/^JUDOJU_TELEGRAM_LINKS=//p')
printf '%s\n' __PREVIOUS__ > previous-compose.txt
printf '%s\n' __KEEP__ > keep-compose.txt
ts=$(date -u +%Y%m%dT%H%M%SZ)
if [ "$(sudo -n docker inspect --format '{{.State.Running}}' $C)" = true ]; then
  sudo -n docker exec $C node --input-type=module -e "import{DatabaseSync}from'node:sqlite';const d=new DatabaseSync('/data/collection.sqlite');d.exec(\"VACUUM INTO '/data/backup-$ts.sqlite'\");d.close();"
  sudo -n docker cp "$C:/data/backup-$ts.sqlite" "$R/collection-before-$ts.sqlite"
  sudo -n docker exec $C node -e "require('node:fs').rmSync('/data/backup-$ts.sqlite')"
  echo "BACKUP=$R/collection-before-$ts.sqlite"
fi
printf 'services:\n  collector:\n    image: %s\n    environment:\n      JUDOJU_TELEGRAM_LINKS: "%s"\n' "$T" "${telegram:-0}" > compose.release.yaml
args=(); while read -r f; do args+=(-f "$f"); done < keep-compose.txt
back=(); while read -r f; do back+=(-f "$f"); done < previous-compose.txt
cd __BASE__/release/workers/collectors
sudo -n docker compose "${args[@]}" -f "$R/compose.release.yaml" up -d --no-build collector
for i in $(seq 1 24); do
  sleep 5
  h=$(sudo -n docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' $C)
  if [ "$h" = healthy ]; then echo "HEALTHY image=$T"; exit 0; fi
done
echo "NOT_HEALTHY: rolling back to the previous compose files"
sudo -n docker compose "${back[@]}" up -d --no-build collector
exit 3
'@
$quote = { param($list) ($list | ForEach-Object { "'$_'" }) -join ' ' }
$deploy = $deploy.Replace('__REMOTE__', $remote).Replace('__CONTAINER__', $container).Replace('__TAG__', $tag).Replace('__BASE__', $base).
  Replace('__PREVIOUS__', (& $quote $composeFiles)).Replace('__KEEP__', (& $quote $keep))
Invoke-Remote $deploy
Start-Sleep -Seconds 60
Invoke-Remote $statusScript

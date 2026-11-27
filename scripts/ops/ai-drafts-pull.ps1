# Publish stage 1A: pull ready AI drafts from the AWS AI processor into the local database inbox (pull mode, no keys).
# export: reads the AI store inside the running container (read-only `cli.mjs export-drafts`) into .local-data\ai-inbox\.
# ingest: maps and passes the newest export file to the local DB (scripts/ai-drafts-ingest.mjs); -DryRun only maps.
# requeue: re-queues one DRAFT_READY job on the server so it is processed again and leaves an export snapshot.
param([Parameter(Mandatory = $true)][ValidateSet('export', 'ingest', 'requeue')][string]$Command, [string]$Job, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$local = Join-Path $repo '.local-data\ai-inbox'
$keys = Join-Path $repo '.local-data\collector-cloud\ssh-lightsail'
$server = 'ubuntu@52.79.247.25'; $container = 'judoju-news-ai-processor-1'
$ssh = @('-i', "$keys\judoju-collector-ed25519", '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', "UserKnownHostsFile=$keys\known_hosts_lightsail",
  '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'HostKeyAlgorithms=ssh-ed25519')
New-Item -ItemType Directory -Force $local | Out-Null
$cli = 'node --experimental-strip-types workers/ai-processing/runtime/cli.mjs'

if ($Command -eq 'export') {
  $file = Join-Path $local ('export-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
  $out = ssh.exe @ssh $server "sudo -n docker exec $container $cli export-drafts --db /ai/processing.sqlite"
  if ($LASTEXITCODE -ne 0) { throw "Export failed (exit $LASTEXITCODE)" }
  $json = ($out | Select-Object -Last 1)
  $parsed = $json | ConvertFrom-Json
  [System.IO.File]::WriteAllText($file, $json)
  Write-Host ("Exported ready={0} revoked={1} -> {2}" -f @($parsed.ready).Count, @($parsed.revoked).Count, $file)
  return
}
if ($Command -eq 'ingest') {
  $file = Get-ChildItem $local -Filter 'export-*.json' | Sort-Object Name | Select-Object -Last 1
  if (-not $file) { throw 'No export file; run export first.' }
  $argsList = @("$repo\scripts\ai-drafts-ingest.mjs", '--input', $file.FullName)
  if ($DryRun) { $argsList += '--dry-run' }
  & node @argsList
  if ($LASTEXITCODE -ne 0) { throw "Ingest failed (exit $LASTEXITCODE)" }
  return
}
if ($Command -eq 'requeue') {
  if ($Job -notmatch '^[A-Za-z0-9_-]{1,80}$') { throw 'Job ID required (-Job)' }
  ssh.exe @ssh $server "sudo -n docker exec $container $cli export-requeue --db /ai/processing.sqlite --job $Job"
  if ($LASTEXITCODE -ne 0) { throw "Requeue failed (exit $LASTEXITCODE)" }
}

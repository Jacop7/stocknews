# Sends one SECTOR_MOVES_V1 file to the AI processor server (docs/sector-news-plan.md §3.5) with the dedicated
# upload key only: the server runs receive.sh for that key and nothing else. No other key, no agent, no password
# fallback; the server host key is pinned. The operations key is refused.
param([Parameter(Mandatory = $true)][string]$Config, [Parameter(Mandatory = $true)][string]$Payload)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
$key = [Environment]::ExpandEnvironmentVariables($cfg.upload.key); $known = [Environment]::ExpandEnvironmentVariables($cfg.upload.knownHosts)
$keysDir = Join-Path $env:LOCALAPPDATA 'judoju\naver-watch\keys'
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'upload-args.ps1')
$sshArgs = Get-UploadArgs -Key $key -KnownHosts $known -KeysDir $keysDir -Server $cfg.upload.server
if ((Get-Item -LiteralPath $Payload).Length -gt 32KB) { throw 'PAYLOAD_TOO_LARGE' }
Get-Content -LiteralPath $Payload -Raw -Encoding UTF8 | & ssh.exe @sshArgs
exit $LASTEXITCODE

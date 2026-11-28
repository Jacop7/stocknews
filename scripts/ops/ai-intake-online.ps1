# Publish stage 2A S4: the cloud AI intake role's password and server secret, status and emergency revoke.
# set-password: makes a 40-character password (letters and digits), puts the one SQL line that sets it on the clipboard,
#               waits while the owner runs it in the Supabase SQL Editor, then sends the intake secret file straight to
#               the server ($base/intake/db.json, owner-only) over ssh stdin. The password is never printed, logged, passed
#               as an argument or stored on this PC; the clipboard is cleared in every case.
# install-ca:   copies the pinned Supabase root CA (supabase/cloud/real-intake-dev/supabase-ca.pem) to $base/intake/ca.pem.
# status:       from the processor container: a real pooler login as the role, session_user, the permission probe
#               (product tables and other functions refused), the delivery queue.
# revoke:       emergency: SQL (function execute revoked, no login, no password, sessions ended) on the clipboard for the
#               owner to run, then push off, the server secret deleted, and a check that the connection now fails.
param([Parameter(Mandatory = $true)][ValidateSet('set-password', 'install-ca', 'status', 'revoke')][string]$Command)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$keys = Join-Path $repo '.local-data\collector-cloud\ssh-lightsail'
$server = 'ubuntu@52.79.247.25'; $base = '/home/ubuntu/.local/share/judoju-ai'; $container = 'judoju-news-ai-processor-1'
$ssh = @('-i', "$keys\judoju-collector-ed25519", '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', "UserKnownHostsFile=$keys\known_hosts_lightsail",
  '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-o', 'HostKeyAlgorithms=ssh-ed25519')
function Invoke-Remote([string]$script) {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($script -replace "`r", '')))
  $output = ssh.exe @ssh $server "echo $encoded | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) { $output; throw "Remote step failed (exit $LASTEXITCODE)" }
  return $output
}
$check = "sudo -n docker exec $container node --experimental-strip-types workers/ai-processing/runtime/cli.mjs push-drafts --db /ai/processing.sqlite --check"
Add-Type -AssemblyName System.Windows.Forms

if ($Command -eq 'set-password') {
  $connection = Get-Content (Join-Path $repo 'supabase\cloud\real-intake-dev\connection.json') -Raw | ConvertFrom-Json
  if ($connection.host -notmatch '^[a-z0-9.-]+\.supabase\.com$' -or $connection.port -notin 5432, 6543 -or $connection.database -ne 'postgres' -or $connection.user -notmatch '^judoju_ai_intake\.[a-z0-9]{20}$') { throw 'connection.json is not the expected pooler setting.' }
  $chars = [char[]]'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  $bytes = [byte[]]::new(40); [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  # 62 letters and digits; bytes 248-255 are redrawn so every character is equally likely.
  $password = -join ($bytes | ForEach-Object { $b = $_; while ($b -ge 248) { $one = [byte[]]::new(1); [System.Security.Cryptography.RandomNumberGenerator]::Fill($one); $b = $one[0] }; $chars[$b % 62] })
  try {
    [System.Windows.Forms.Clipboard]::SetText("alter role judoju_ai_intake login password '$password';")
    Write-Host 'The SQL line is on the clipboard. Paste it into the Supabase SQL Editor (project judoju-news-dev) and click Run.'
    Read-Host 'When the editor shows "Success. No rows returned", press Enter here' | Out-Null
    $json = [ordered]@{ host = $connection.host; port = [int]$connection.port; database = 'postgres'; user = $connection.user; password = $password } | ConvertTo-Json -Compress
    $json | ssh.exe @ssh $server "set -e; umask 077; install -d -m 711 $base/intake; cat > $base/intake/db.json.tmp; chmod 600 $base/intake/db.json.tmp; mv $base/intake/db.json.tmp $base/intake/db.json"
    if ($LASTEXITCODE -ne 0) { throw 'Sending the intake secret failed.' }
    $json = $null
  } finally {
    try { [System.Windows.Forms.Clipboard]::Clear() } catch {}
    $password = $null
  }
  Write-Host 'Intake secret saved on the server (not printed). Checking the connection...'
  Invoke-Remote $check
  return
}

if ($Command -eq 'install-ca') {
  $ca = Join-Path $repo 'supabase\cloud\real-intake-dev\supabase-ca.pem'
  if (-not (Test-Path $ca) -or (Get-Content $ca -Raw) -notmatch '^-----BEGIN CERTIFICATE-----') { throw 'supabase-ca.pem missing or not a certificate.' }
  Get-Content $ca -Raw | ssh.exe @ssh $server "set -e; install -d -m 711 $base/intake; cat > $base/intake/ca.pem.tmp; chmod 644 $base/intake/ca.pem.tmp; mv $base/intake/ca.pem.tmp $base/intake/ca.pem; sha256sum $base/intake/ca.pem | cut -c1-64"
  if ($LASTEXITCODE -ne 0) { throw 'CA upload failed.' }
  return
}

if ($Command -eq 'status') { Invoke-Remote $check; return }

if ($Command -eq 'revoke') {
  $sql = @'
begin;
revoke execute on function ai_intake.submit(text,jsonb), ai_intake.withdraw(text,text,integer,text) from judoju_ai_intake;
alter role judoju_ai_intake nologin password null;
select count(*) as sessions_ended from (select pg_terminate_backend(pid) from pg_stat_activity where usename='judoju_ai_intake') x;
select (select rolcanlogin from pg_roles where rolname='judoju_ai_intake') as can_login,
  has_function_privilege('judoju_ai_intake','ai_intake.submit(text,jsonb)','EXECUTE') as submit_allowed,
  has_function_privilege('judoju_ai_intake','ai_intake.withdraw(text,text,integer,text)','EXECUTE') as withdraw_allowed;
commit;
'@
  try {
    [System.Windows.Forms.Clipboard]::SetText($sql)
    Write-Host 'Emergency SQL is on the clipboard. Run it in the Supabase SQL Editor; the last result must show can_login=false, submit_allowed=false, withdraw_allowed=false.'
    Read-Host 'Press Enter here after it ran' | Out-Null
  } finally { try { [System.Windows.Forms.Clipboard]::Clear() } catch {} }
  & (Join-Path $PSScriptRoot 'ai-processor.ps1') push-off
  Invoke-Remote "rm -f $base/intake/db.json $base/intake/db.json.tmp; test ! -e $base/intake/db.json && echo SECRET_DELETED"
  $after = ssh.exe @ssh $server "$check 2>&1 | tail -1"
  if ($after -match '"sessionUser":"judoju_ai_intake"') { throw 'REVOKE_UNCONFIRMED: the intake connection still works.' }
  Write-Host 'Revoked: push off, server secret deleted, the intake connection fails.'
  return
}

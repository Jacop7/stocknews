# Naver watchlist capture: install, status, remove (docs/sector-news-plan.md §3). Windows PowerShell 5.1.
#   -Install    copies config.example.json to %LOCALAPPDATA%\judoju\naver-watch\config.json (if missing) and registers a
#               Task Scheduler task that runs capture.ps1 every 5 minutes from 08:00 for 12 hours (capture.ps1 itself
#               skips weekends and hours outside 08:00–20:00 KST).
#   -Status     task state and the last log lines (reasons and counts only).
#   -Remove     unregisters the task and deletes the baseline file, work folders and log (keys stay unless -RemoveKeys).
#   -NewKey     creates the dedicated upload key (ed25519) in the keys folder and prints its public key. Creating and
#               registering this key is done only with the owner's approval; registration on the server restricts it
#               to receive.sh (see docs/sector-news-plan.md §3.5).
param([switch]$Install, [switch]$Status, [switch]$Remove, [switch]$RemoveKeys, [switch]$NewKey)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$home_ = Join-Path $env:LOCALAPPDATA 'judoju\naver-watch'; $keys = Join-Path $home_ 'keys'; $task = 'JudojuNaverWatchCapture'
if ($Install) {
  New-Item -ItemType Directory -Force -Path $home_ | Out-Null
  & icacls.exe $home_ /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ACL_FAILED' }
  $cfg = Join-Path $home_ 'config.json'
  if (-not (Test-Path $cfg)) { Copy-Item (Join-Path $here 'config.example.json') $cfg }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $here 'capture.ps1')`""
  $trigger = New-ScheduledTaskTrigger -Daily -At '08:00'
  $trigger.Repetition = (New-ScheduledTaskTrigger -Once -At '08:00' -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Hours 12)).Repetition
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -StartWhenAvailable:$false
  Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Settings $settings -Description 'Judoju News: Naver watchlist capture → sector moves (internal news ordering only)' -Force | Out-Null
  Write-Output "INSTALLED $task (config: $cfg)"
}
if ($Status) {
  $t = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
  Write-Output ("TASK " + $(if ($t) { $t.State } else { 'ABSENT' }))
  $log = Join-Path $home_ 'capture.log'; if (Test-Path $log) { Get-Content $log -Tail 10 }
  Write-Output ("BASELINE " + $(if (Test-Path (Join-Path $home_ 'state\last-round.json')) { 'PRESENT' } else { 'ABSENT' }))
}
if ($Remove) {
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  foreach ($p in @((Join-Path $home_ 'state'), (Join-Path $home_ 'work'), (Join-Path $home_ 'capture.log'))) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue }
  if ($RemoveKeys) { Remove-Item -LiteralPath $keys -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Output 'REMOVED'
}
if ($NewKey) {
  New-Item -ItemType Directory -Force -Path $keys | Out-Null
  & icacls.exe $keys /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'ACL_FAILED' }
  $file = Join-Path $keys 'upload-ed25519'
  if (Test-Path $file) { throw 'UPLOAD_KEY_EXISTS' }
  & ssh-keygen.exe -t ed25519 -N '""' -C 'judoju-naver-watch-upload' -f $file | Out-Null
  Write-Output ('PUBLIC_KEY ' + (Get-Content "$file.pub" -Raw).Trim())
}

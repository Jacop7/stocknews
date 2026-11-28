# Naver watchlist capture round (docs/sector-news-plan.md §3.2). Windows PowerShell 5.1.
# The user opens Naver Securities → MY → 관심 종목 in Chrome or Edge, signed in by themselves, zoom 100%, light theme.
# Every run (Task Scheduler, every 5 minutes, weekdays 08:00–20:00 KST): one window is found by title, each watchlist
# tab is selected through UI Automation, the page is scrolled and captured (PrintWindow, no focus change), each
# screenshot is OCR'd, round.mjs turns the round into sector averages, and upload.ps1 sends them. No reload, no
# navigation, no login, no random timing. Screenshots and OCR files live only in a per-round work folder that is
# deleted in finally; the only lasting file is the one baseline (state\last-round.json). Logs carry reasons and counts.
param([string]$Config = (Join-Path $env:LOCALAPPDATA 'judoju\naver-watch\config.json'), [switch]$Once, [switch]$NoUpload, [switch]$Check)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$home_ = Join-Path $env:LOCALAPPDATA 'judoju\naver-watch'
$work = Join-Path $home_ 'work'; $state = Join-Path $home_ 'state\last-round.json'; $log = Join-Path $home_ 'capture.log'
function Write-Log([hashtable]$entry) { $entry.at = (Get-Date).ToUniversalTime().ToString('o'); Add-Content -LiteralPath $log -Value ($entry | ConvertTo-Json -Compress) -Encoding UTF8 }

$mutex = New-Object System.Threading.Mutex($false, 'Local\JudojuNaverWatchCapture')
if (-not $mutex.WaitOne(0)) { exit 0 }   # another round is still running
try {
  New-Item -ItemType Directory -Force -Path $home_, $work, (Split-Path $state) | Out-Null
  # Current user only (no inheritance).
  & icacls.exe $home_ /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Log @{ result = 'NO_UPLOAD'; reason = 'ACL_FAILED' }; exit 1 }
  # Stale work folders from a crash.
  Get-ChildItem -LiteralPath $work -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  # A temporary baseline copy left by a crash (only last-round.json may exist).
  Get-ChildItem -LiteralPath (Split-Path $state) -Filter 'last-round.json.tmp-*' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  $cfg = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json

  # Weekdays 08:00–20:00 KST only (the market state check decides whether anything is uploaded).
  $kst = [DateTime]::UtcNow.AddHours(9)
  if (-not $Once -and ($kst.DayOfWeek -in 'Saturday', 'Sunday' -or $kst.Hour -lt 8 -or $kst.Hour -ge 20)) { exit 0 }

  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
  Add-Type @'
using System; using System.Runtime.InteropServices;
public static class NwWin {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
  $A = [System.Windows.Automation.AutomationElement]; $T = [System.Windows.Automation.TreeScope]; $C = [System.Windows.Automation.Condition]
  # Exactly one browser window whose title contains the configured text.
  $windows = $A::RootElement.FindAll($T::Children, $C::TrueCondition) | Where-Object {
    $_.Current.Name -like "*$($cfg.windowTitle)*" -and ((Get-Process -Id $_.Current.ProcessId -ErrorAction SilentlyContinue).ProcessName -in $cfg.processNames) }
  if (@($windows).Count -ne 1) { Write-Log @{ result = 'NO_UPLOAD'; reason = 'WINDOW_COUNT_' + @($windows).Count }; exit 1 }
  $window = @($windows)[0]; $hwnd = [IntPtr]$window.Current.NativeWindowHandle
  if ([NwWin]::IsIconic($hwnd)) { Write-Log @{ result = 'NO_UPLOAD'; reason = 'WINDOW_MINIMIZED' }; exit 1 }
  if (Get-Process -Name LogonUI -ErrorAction SilentlyContinue) { Write-Log @{ result = 'NO_UPLOAD'; reason = 'DESKTOP_LOCKED' }; exit 1 }
  Add-Type -AssemblyName System.Windows.Forms
  $vr = [System.Windows.Forms.SystemInformation]::VirtualScreen; $wr = New-Object NwWin+RECT; [void][NwWin]::GetWindowRect($hwnd, [ref]$wr)
  if ($wr.Left -lt $vr.Left -or $wr.Top -lt $vr.Top -or $wr.Right -gt $vr.Right -or $wr.Bottom -gt $vr.Bottom) { Write-Log @{ result = 'NO_UPLOAD'; reason = 'WINDOW_OFF_SCREEN' }; exit 1 }

  function Capture-Window([string]$path) {
    $r = New-Object NwWin+RECT; [void][NwWin]::GetWindowRect($hwnd, [ref]$r)
    $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
    if ($w -lt 400 -or $h -lt 300) { throw 'WINDOW_TOO_SMALL' }
    $bmp = New-Object System.Drawing.Bitmap $w, $h; $g = [System.Drawing.Graphics]::FromImage($bmp)
    try { $dc = $g.GetHdc(); try { if (-not [NwWin]::PrintWindow($hwnd, $dc, 2)) { throw 'PRINTWINDOW_FAILED' } } finally { $g.ReleaseHdc($dc) }; $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $g.Dispose(); $bmp.Dispose() }
  }
  function Find-Named([string]$name) {
    $all = $window.FindAll($T::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::NameProperty, $name)))
    if ($all.Count -eq 0) { $all = $window.FindAll($T::Descendants, $C::TrueCondition) | Where-Object { $_.Current.Name -match ('^' + [regex]::Escape($name) + '\s+\d+$') } }
    return @($all)
  }
  $doc = $window.FindFirst($T::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)))
  if (-not $doc) { Write-Log @{ result = 'NO_UPLOAD'; reason = 'DOCUMENT_NOT_FOUND' }; exit 1 }
  $scroll = $null; try { $scroll = $doc.GetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern) } catch {}

  $round = Join-Path $work ([DateTime]::UtcNow.ToString('yyyyMMddTHHmmss')); New-Item -ItemType Directory -Path $round | Out-Null
  $started = [DateTime]::UtcNow
  try {
    $expected = @{}; $listNo = 0; $prevListIds = ''
    foreach ($list in $cfg.lists) {
      $listNo++; $expected["$listNo"] = [int]$list.expected
      $tab = Find-Named $list.name
      if ($tab.Count -ne 1) { throw "TAB_NOT_FOUND_$listNo" }
      try { $tab[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
      catch { $tab[0].GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select() }
      Start-Sleep -Seconds 2
      # The tab must report itself selected when it supports selection; otherwise the company-set check below decides.
      $sel = $null; try { $sel = $tab[0].GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern) } catch {}
      if ($sel -and -not $sel.Current.IsSelected) { throw "TAB_NOT_SELECTED_$listNo" }
      if ($scroll) { $scroll.SetScrollPercent(-1, 0) }
      Start-Sleep -Milliseconds 500
      $maxPages = [Math]::Ceiling([int]$list.expected / [int]$cfg.rowsPerScreen) + 2
      $prevIds = $null; $ended = $false; $listIds = ''
      for ($page = 1; $page -le $maxPages; $page++) {
        $png = Join-Path $round "$listNo-$page.png"; Capture-Window $png
        $json = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'ocr.ps1') -Path $png
        Remove-Item -LiteralPath $png -Force
        $jsonPath = Join-Path $round "$listNo-$page.json"; [IO.File]::WriteAllText($jsonPath, ($json -join ''), (New-Object Text.UTF8Encoding $false))
        $ids = (& node (Join-Path $here 'page-ids.mjs') $jsonPath) -join ''
        if ($ids -eq $prevIds) { Remove-Item -LiteralPath $jsonPath -Force; $ended = $true; break }   # same companies: end of the list
        $prevIds = $ids; $listIds += $ids
        if ($scroll -and $scroll.VerticalScrollPercent -ge 99.9) { $ended = $true; break }
        if ($scroll) { $scroll.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, [System.Windows.Automation.ScrollAmount]::LargeIncrement) }
        Start-Sleep -Milliseconds 700
      }
      if (-not $ended) { throw "LIST_INCOMPLETE_$listNo" }
      if ($listIds -eq $prevListIds -and $listIds) { throw "TAB_SWITCH_FAILED_$listNo" }   # same companies as the previous list
      $prevListIds = $listIds
    }
    $finished = [DateTime]::UtcNow
    $out = Join-Path $round 'sector-moves.json'
    $roundArgs = @('--ocr-dir', $round, '--state', $state, '--out', $out, '--started', $started.ToString('o'), '--finished', $finished.ToString('o'), '--expected', ($expected | ConvertTo-Json -Compress))
    if ($Check) { $roundArgs += '--check' }
    $result = & node (Join-Path $here 'round.mjs') @roundArgs
    if ($Check) { $result | ForEach-Object { Write-Output $_ }; Write-Log @{ result = 'CHECK' }; return }   # -Check never uploads
    $summary = ($result | Select-Object -Last 1) | ConvertFrom-Json
    if ($summary.upload -and -not $NoUpload) {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'upload.ps1') -Config $Config -Payload $out
      Write-Log @{ result = $(if ($LASTEXITCODE -eq 0) { 'UPLOADED' } else { 'UPLOAD_FAILED' }); rows = $summary.rows; coverage = $summary.coverage; state = $summary.state }
    } else { Write-Log @{ result = 'NO_UPLOAD'; reason = $summary.reason; rows = $summary.rows; coverage = $summary.coverage; state = $summary.state } }
  } catch {
    $reason = if ($_.Exception.Message -match '^[A-Z_0-9]+$') { $_.Exception.Message } else { 'CAPTURE_FAILED' }
    Write-Log @{ result = 'NO_UPLOAD'; reason = $reason }; if ($Check) { Write-Output $reason }; exit 1
  } finally { Remove-Item -LiteralPath $round -Recurse -Force -ErrorAction SilentlyContinue }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }

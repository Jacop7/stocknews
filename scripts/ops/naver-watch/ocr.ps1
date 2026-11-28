# Naver watchlist capture → OCR (docs/sector-news-plan.md §1.2). Windows PowerShell 5.1 only (WinRT OCR, Korean).
# Prints one JSON object: { width, height, words: [{ text, x, y, w, h, line, color }] } where color is the average
# colour of the word's ink pixels (used for the up/down sign: red = up, blue = down). Reads one image; writes nothing.
param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait() | Out-Null; $task.Result }
$full = (Resolve-Path -LiteralPath $Path).Path
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($full)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('ko'))
if (-not $engine) { throw 'OCR_KOREAN_UNAVAILABLE' }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$stream.Dispose()
$image = [System.Drawing.Bitmap]::FromFile($full)
try {
  # Average colour of pixels clearly darker or more saturated than the white background.
  function Ink($r) {
    $sr = 0; $sg = 0; $sb = 0; $n = 0
    $x0 = [Math]::Max(0, [int]$r.X); $y0 = [Math]::Max(0, [int]$r.Y)
    $x1 = [Math]::Min($image.Width - 1, [int]($r.X + $r.Width)); $y1 = [Math]::Min($image.Height - 1, [int]($r.Y + $r.Height))
    for ($y = $y0; $y -le $y1; $y++) { for ($x = $x0; $x -le $x1; $x++) {
      $p = $image.GetPixel($x, $y); $max = [Math]::Max($p.R, [Math]::Max($p.G, $p.B)); $min = [Math]::Min($p.R, [Math]::Min($p.G, $p.B))
      if ($max -lt 200 -or ($max - $min) -gt 60) { $sr += $p.R; $sg += $p.G; $sb += $p.B; $n++ }
    } }
    if ($n -eq 0) { return $null }
    return @([int]($sr / $n), [int]($sg / $n), [int]($sb / $n))
  }
  $words = New-Object System.Collections.ArrayList
  $lineNo = 0
  foreach ($line in $result.Lines) {
    foreach ($word in $line.Words) {
      $b = $word.BoundingRect
      [void]$words.Add([ordered]@{ text = $word.Text; x = [int]$b.X; y = [int]$b.Y; w = [int]$b.Width; h = [int]$b.Height; line = $lineNo; color = (Ink $b) })
    }
    $lineNo++
  }
  [ordered]@{ width = $image.Width; height = $image.Height; words = $words } | ConvertTo-Json -Depth 5 -Compress
} finally { $image.Dispose() }

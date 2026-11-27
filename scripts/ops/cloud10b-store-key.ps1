# Stores the Supabase dev project's public (publishable or legacy anon) key for CLOUD10B without echoing it.
# Get it from: Supabase dashboard > judoju-news-dev > Project Settings > API Keys:
#   "Publishable key" (sb_publishable_...)  or  Legacy API keys > "anon public" (a long eyJ... JWT).
# Never paste the secret key (sb_secret_...) or the service_role key here.
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$folder = Join-Path $repo '.local-data\cloud-preview'
New-Item -ItemType Directory -Force $folder | Out-Null
$secure = Read-Host 'Public key (input hidden)' -AsSecureString
$raw = [System.Net.NetworkCredential]::new('', $secure).Password
# Drop surrounding quotes, whitespace and invisible characters that copy/paste can add.
$key = ($raw -replace '[​-‍﻿\s]', '').Trim('"', "'")

function Get-Kind([string]$value) {
  if ($value -match '^sb_publishable_[A-Za-z0-9_-]{16,256}$') { return 'PUBLISHABLE' }
  if ($value -match '^sb_secret_') { return 'SECRET' }
  if ($value -match '^[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$') {
    $part = $Matches[1].Replace('-', '+').Replace('_', '/'); while ($part.Length % 4) { $part += '=' }
    try { $payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($part)) | ConvertFrom-Json } catch { return 'UNKNOWN' }
    if ($payload.role -eq 'anon') { return 'LEGACY_ANON_JWT' }
    if ($payload.role -eq 'service_role') { return 'SERVICE_ROLE' }
  }
  return 'UNKNOWN'
}
$kind = Get-Kind $key
switch ($kind) {
  'SECRET' { throw 'This is a SECRET key (sb_secret_...). Do not use it. Copy the Publishable key instead. Nothing was saved.' }
  'SERVICE_ROLE' { throw 'This is the service_role key. Do not use it. Copy the anon public or Publishable key instead. Nothing was saved.' }
  'UNKNOWN' {
    # Describe the shape only (never the key): length and the non-secret leading label.
    $label = if ($key -match '^(sb_[a-z]+_)') { $Matches[1] } elseif ($key.StartsWith('eyJ')) { 'eyJ (JWT-like)' } else { 'unrecognized start' }
    throw "Not a public key. Length $($key.Length), starts with: $label. Expected sb_publishable_... or the anon public JWT (eyJ...). Nothing was saved."
  }
}
[System.IO.File]::WriteAllText((Join-Path $folder 'publishable.key'), $key)
Write-Host "Saved .local-data\cloud-preview\publishable.key ($kind, not printed)."

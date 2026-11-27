# Stores the Supabase dev project's publishable key for CLOUD10B without echoing it.
# Get it from: Supabase dashboard > judoju-news-dev > Project Settings > API Keys > Publishable key (sb_publishable_...).
# Never paste the secret key or the service_role key here.
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$folder = Join-Path $repo '.local-data\cloud-preview'
New-Item -ItemType Directory -Force $folder | Out-Null
$secure = Read-Host 'Publishable key (input hidden)' -AsSecureString
$key = [System.Net.NetworkCredential]::new('', $secure).Password.Trim()
if ($key -notmatch '^sb_publishable_[A-Za-z0-9_-]{16,256}$') { throw 'Not a publishable key (expected sb_publishable_...). Nothing was saved.' }
[System.IO.File]::WriteAllText((Join-Path $folder 'publishable.key'), $key)
Write-Host 'Saved .local-data\cloud-preview\publishable.key (not printed).'

# Builds the ssh.exe arguments for the sector-move upload (docs/sector-news-plan.md §3.5). Separate so it can be tested.
# The key must be the dedicated upload key in the user's naver-watch keys folder; the operations key is refused.
function Get-UploadArgs([string]$Key, [string]$KnownHosts, [string]$KeysDir, [string]$Server) {
  $full = [IO.Path]::GetFullPath($Key); $dir = [IO.Path]::GetFullPath($KeysDir).TrimEnd('\') + '\'
  if (-not $full.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase)) { throw 'UPLOAD_KEY_OUTSIDE_KEYS_DIR' }
  if ($full -ne ($dir + 'upload-ed25519')) { throw 'UPLOAD_KEY_NOT_THE_UPLOAD_KEY' }
  if ($full -match 'judoju-collector|ssh-lightsail') { throw 'OPERATIONS_KEY_REFUSED' }
  if ($Server -notmatch '^ubuntu@[0-9.]+$') { throw 'UPLOAD_SERVER_INVALID' }
  return @('-i', $full, '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'BatchMode=yes', '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no', '-o', 'StrictHostKeyChecking=yes', '-o', "UserKnownHostsFile=$([IO.Path]::GetFullPath($KnownHosts))",
    '-o', 'HostKeyAlgorithms=ssh-ed25519', '-o', 'ConnectTimeout=10', '-T', $Server)
}

param([Parameter(Mandatory=$true)][ValidateSet('Inspect','CreateFixture','VerifyFixture','WriteFixture','ReadFixture','PrivateFixture','Supervise','DeathTest','CreateActual','WriteActualFile','ReadActualFile','ReadActual','AppendActualJournal','ReadActualJournal','ActualStatus','DeleteActualSecrets','Clock','OperatorIdentity','ReadOperatorToken')][string]$Operation)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$productRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
try {
  if (-not [String]::Equals([IO.Path]::GetFullPath((Get-Location).ProviderPath), $productRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'FIXED_CWD_REQUIRED' }
  # Explicit execution only. Uses the OS PowerShell 5.1 compiler, never a Codex binary.
  Add-Type -Path (Join-Path $PSScriptRoot 'admin-preview-native.cs') -ReferencedAssemblies 'System.Web.Extensions','System.Core'
  $request = [Console]::In.ReadToEnd()
  [JudojuAdminNative]::Run($productRoot, $Operation, $request)
} catch {
  $reason = 'NATIVE_EXECUTION_FAILED'
  $inner = $_.Exception.InnerException
  if ($null -ne $inner -and $inner.Message -cmatch '^[A-Z_]{3,80}$') { $reason = $inner.Message }
  [Console]::Out.WriteLine(('{"status":"HOLD","reason":"' + $reason + '"}'))
  exit 1
}

param([Parameter(Mandatory=$true)][ValidateSet('Install','Rollback')][string]$Mode)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$appRoot = Join-Path $env:LOCALAPPDATA 'NetunimKupaBankBridge'
$startup = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
[IO.Directory]::CreateDirectory($appRoot) | Out-Null

# One setup at a time, including preparation of the private runtime and browser.
# Windows releases the lock when the owning process exits.
$lock = [IO.File]::Open((Join-Path $appRoot 'setup.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
  $nodeInstaller = Join-Path $PSScriptRoot 'install_node_runtime.ps1'
  if ($Mode -eq 'Install') {
    $node = & $nodeInstaller -AppRoot $appRoot -WithNpm
  } else {
    $node = & $nodeInstaller -AppRoot $appRoot -VerifyOnly
  }
  & $node (Join-Path $PSScriptRoot 'setup-bank-bridge.mjs') $Mode $appRoot $startup
  exit $LASTEXITCODE
} finally {
  $lock.Dispose()
}

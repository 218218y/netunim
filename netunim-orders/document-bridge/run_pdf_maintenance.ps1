param([switch]$Force, [int]$MaxFiles = 0)
$ErrorActionPreference = 'Stop'
$appRoot = Join-Path $env:LOCALAPPDATA 'NetunimDocumentBridge'
$activeFile = Join-Path $appRoot 'active-runtime.txt'
$nodePointer = Join-Path $appRoot 'node-runtime.txt'
$runtimeName = (Get-Content -LiteralPath $activeFile -Raw -Encoding UTF8).Trim()
$nodeRuntimeName = (Get-Content -LiteralPath $nodePointer -Raw -Encoding UTF8).Trim()
if ($runtimeName -notmatch '^app-v[0-9]+-[0-9]+-[0-9]+$') { throw 'Invalid active Document Bridge runtime name.' }
if ($nodeRuntimeName -notmatch '^node-v24\.21\.0-win-x64-[0-9]{8}-[0-9]{6}-[0-9]+-[0-9a-f]{8}$') { throw 'Invalid pinned private Node runtime name.' }
$server = Join-Path (Join-Path $appRoot $runtimeName) 'server.mjs'
$node = Join-Path (Join-Path $appRoot $nodeRuntimeName) 'node.exe'
if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { throw 'Active Document Bridge runtime is missing.' }
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'Pinned private Node runtime is missing.' }
$output = Join-Path $appRoot 'pdf-maintenance-console.log'
$nodeArgs = @($server, '--refresh-pdf-index')
if ($Force) { $nodeArgs += '--force' }
if ($MaxFiles -gt 0) { $nodeArgs += '--max-files=' + $MaxFiles }
# Windows PowerShell 5.1 can promote native-process stderr diagnostics to PowerShell errors.
# Keep native stderr in the maintenance log and use the child process exit code as the authoritative result.
$ErrorActionPreference = 'Continue'
& $node @nodeArgs *> $output
$workerExitCode = $LASTEXITCODE
exit $workerExitCode

param([switch]$Force, [int]$MaxFiles = 0)
$ErrorActionPreference = 'Stop'
$appRoot = Join-Path $env:LOCALAPPDATA 'NetunimDocumentBridge'
$activeFile = Join-Path $appRoot 'active-runtime.txt'
$runtimeName = (Get-Content -LiteralPath $activeFile -Raw -Encoding UTF8).Trim()
if ($runtimeName -notmatch '^app-v[0-9]+-[0-9]+-[0-9]+$') { throw 'Invalid active Document Bridge runtime name.' }
$server = Join-Path (Join-Path $appRoot $runtimeName) 'server.mjs'
if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { throw 'Active Document Bridge runtime is missing.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
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

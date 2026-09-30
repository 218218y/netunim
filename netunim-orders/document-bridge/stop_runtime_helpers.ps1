param(
  [Parameter(Mandatory=$true)][string]$AppRoot
)

$ErrorActionPreference = 'SilentlyContinue'
$root = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd('\\') + '\\'
$processes = @(Get-CimInstance Win32_Process)
$targets = New-Object System.Collections.Generic.HashSet[int]

foreach ($process in $processes) {
  $pidValue = [int]$process.ProcessId
  if ($pidValue -le 0 -or $pidValue -eq $PID) { continue }
  $name = [string]$process.Name
  $exe = [string]$process.ExecutablePath
  $command = [string]$process.CommandLine

  if ($name -ieq 'NetunimPreviewHost.exe' -and $exe.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    [void]$targets.Add($pidValue)
    continue
  }

  # Old bridge releases started Node through a hidden cmd.exe whose current
  # directory was the runtime directory. Killing that verified wrapper tree is
  # safe and releases the directory handle even if Node already closed port 8766.
  if ($name -ieq 'cmd.exe' -and
      $command.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $command.IndexOf('start_document_bridge.bat', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    [void]$targets.Add($pidValue)
    continue
  }

  # v26+ uses an absolute server.mjs path, so a rare orphaned Node process can
  # also be identified without touching unrelated Node applications.
  if ($name -ieq 'node.exe' -and
      $command.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $command.IndexOf('server.mjs', [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
    [void]$targets.Add($pidValue)
  }
}

foreach ($targetPid in $targets) {
  & taskkill.exe /PID $targetPid /T /F *> $null
}

if ($targets.Count -gt 0) { Start-Sleep -Milliseconds 400 }
exit 0

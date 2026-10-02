param(
  [Parameter(Mandatory=$true)][string]$AppRoot,
  [switch]$RestoreBackup
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$taskName = 'NetunimDocumentBridgePdfMaintenance'
$script = Join-Path $AppRoot 'run_pdf_maintenance.ps1'
$backupPath = Join-Path $AppRoot 'pdf-maintenance-task.before-install.xml'
$missingMarker = Join-Path $AppRoot 'pdf-maintenance-task.before-install.missing'

function Clear-TaskBackup {
  Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $missingMarker -Force -ErrorAction SilentlyContinue
}

function Restore-TaskBackup {
  if (Test-Path -LiteralPath $missingMarker -PathType Leaf) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Clear-TaskBackup
    Write-Output "Removed newly-created PDF maintenance task during rollback: $taskName"
    return
  }
  if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
    $xml = Get-Content -LiteralPath $backupPath -Raw -Encoding UTF8
    Register-ScheduledTask -TaskName $taskName -Xml $xml -Force | Out-Null
    Clear-TaskBackup
    Write-Output "Restored previous PDF maintenance task during rollback: $taskName"
  }
}

if ($RestoreBackup) {
  Restore-TaskBackup
  exit 0
}

if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'PDF maintenance runner is missing.' }

Clear-TaskBackup
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
  $xml = Export-ScheduledTask -TaskName $taskName
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($backupPath, [string]$xml, $utf8NoBom)
} else {
  New-Item -ItemType File -Path $missingMarker -Force | Out-Null
}

try {
  $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '"'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $AppRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At '12:00'
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -Priority 9
  $principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
  $registeredAction = @($task.Actions)[0]
  $triggers = @($task.Triggers)
  $triggerEnabled = (@($triggers | Where-Object { $_.Enabled -ne $false }).Count -gt 0)
  $executeLeaf = [System.IO.Path]::GetFileName([string]$registeredAction.Execute)
  $registeredWorkingDirectory = ([string]$registeredAction.WorkingDirectory).TrimEnd('\')
  $expectedWorkingDirectory = ([System.IO.Path]::GetFullPath($AppRoot)).TrimEnd('\')
  $actualWorkingDirectory = if ($registeredWorkingDirectory) { ([System.IO.Path]::GetFullPath($registeredWorkingDirectory)).TrimEnd('\') } else { '' }

  if ($task.State -eq 'Disabled') { throw 'PDF maintenance task was registered disabled.' }
  if (-not $triggerEnabled) { throw 'PDF maintenance task has no enabled trigger.' }
  if ($info.NextRunTime.Year -le 1900) { throw 'PDF maintenance task has no next run time.' }
  if ($executeLeaf -ine 'powershell.exe') { throw "PDF maintenance task action executable is unexpected: $($registeredAction.Execute)" }
  if (([string]$registeredAction.Arguments).IndexOf($script, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { throw 'PDF maintenance task action does not point to the installed maintenance runner.' }
  if ($actualWorkingDirectory -ine $expectedWorkingDirectory) { throw 'PDF maintenance task working directory is incorrect.' }
  if (-not $task.Settings.DisallowStartIfOnBatteries -or -not $task.Settings.StopIfGoingOnBatteries) { throw 'PDF maintenance task must require AC power.' }

  Write-Output "Scheduled PDF maintenance task: $taskName"
  Write-Output ("Next Run Time: {0:o}" -f $info.NextRunTime)
} catch {
  $installError = $_
  try {
    Restore-TaskBackup
  } catch {
    throw "PDF maintenance task installation failed and its previous state could not be restored. Install error: $($installError.Exception.Message). Rollback error: $($_.Exception.Message)"
  }
  throw $installError
}

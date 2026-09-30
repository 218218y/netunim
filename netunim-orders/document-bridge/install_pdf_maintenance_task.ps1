param([Parameter(Mandatory=$true)][string]$AppRoot)
$ErrorActionPreference = 'Stop'
$script = Join-Path $AppRoot 'run_pdf_maintenance.ps1'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'PDF maintenance runner is missing.' }
$taskName = 'NetunimDocumentBridgePdfMaintenance'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $script + '"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $AppRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '12:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -Priority 9
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
$task = Get-ScheduledTask -TaskName $taskName
if ($task.State -eq 'Disabled') { throw 'PDF maintenance task was registered disabled.' }
if (-not $task.Settings.DisallowStartIfOnBatteries -or -not $task.Settings.StopIfGoingOnBatteries) { throw 'PDF maintenance task must require AC power.' }
Write-Output "Scheduled PDF maintenance task: $taskName"

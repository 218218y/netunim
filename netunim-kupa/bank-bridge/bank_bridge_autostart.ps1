param([Parameter(Mandatory=$true)][ValidateSet('Prepare','Register','Remove')][string]$Mode)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$appRoot = Join-Path $env:LOCALAPPDATA 'NetunimKupaBankBridge'

$launcherName = 'BankBridgeStartup.exe'
if ($Mode -eq 'Prepare') {
  Add-Type -LiteralPath (Join-Path $PSScriptRoot 'bank_bridge_startup.cs') -OutputType WindowsApplication `
    -OutputAssembly (Join-Path $PSScriptRoot $launcherName)
  exit 0
}

$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$taskName = "NetunimKupaBankBridge-$sid"
$taskPath = '\'
$startup = [Environment]::GetFolderPath('Startup')
if (-not $startup) { throw 'Windows did not return a Startup folder for the current user.' }
$legacy = Join-Path $startup 'NetunimKupaBankBridge.vbs'
$existing = Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue

if ($Mode -eq 'Remove') {
  if ($existing) { Unregister-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Confirm:$false }
  [IO.File]::Delete($legacy)
  Write-Output 'Bank Bridge autostart removed.'
  exit 0
}

$runner = Join-Path (Join-Path $appRoot 'setup') $launcherName
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { throw 'The installed Bank Bridge launcher is missing.' }
$action = New-ScheduledTaskAction -Execute $runner -WorkingDirectory $appRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $sid
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
$previousXml = if ($existing) { Export-ScheduledTask -TaskPath $taskPath -TaskName $taskName }
$registered = $false

try {
  Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null
  $registered = $true
  $task = Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName
  if ($task.State -eq 'Disabled' -or $task.Triggers.Count -ne 1 -or -not $task.Triggers[0].Enabled -or
      $task.Triggers[0].CimClass.CimClassName -ne 'MSFT_TaskLogonTrigger') {
    throw 'Windows did not register an enabled Bank Bridge sign-in trigger.'
  }
  # The scheduler may return a qualified account name for a trigger supplied
  # as a SID. Its exported principal retains the canonical SID.
  $triggerSid = $task.Triggers[0].UserId
  if ($triggerSid -ne $sid) {
    $triggerSid = [Security.Principal.NTAccount]::new($triggerSid).Translate([Security.Principal.SecurityIdentifier]).Value
  }
  [xml]$definition = Export-ScheduledTask -TaskPath $taskPath -TaskName $taskName
  if ($triggerSid -ne $sid -or $definition.Task.Principals.Principal.UserId -ne $sid -or
      $task.Principal.LogonType -ne 'Interactive' -or $task.Principal.RunLevel -ne 'Limited') {
    throw 'The Bank Bridge task principal or sign-in trigger does not match the current user.'
  }
  if ($task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ne $runner -or
      $task.Actions[0].Arguments -or $task.Actions[0].WorkingDirectory -ne $appRoot) {
    throw 'Windows did not register the expected Bank Bridge task action.'
  }
  if ($task.Settings.MultipleInstances -ne 'IgnoreNew' -or $task.Settings.ExecutionTimeLimit -ne 'PT0S' -or
      $task.Settings.DisallowStartIfOnBatteries -or $task.Settings.StopIfGoingOnBatteries) {
    throw 'Windows did not register the expected Bank Bridge task settings.'
  }
  [IO.File]::Delete($legacy)
} catch {
  $registrationError = $_
  if ($registered) {
    try {
      if ($previousXml) { Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Xml $previousXml -Force | Out-Null }
      else { Unregister-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Confirm:$false }
    } catch {
      throw "Bank Bridge autostart setup failed: $registrationError. Restoring the previous task also failed: $_"
    }
  }
  throw $registrationError
}

Write-Output "Registered the Bank Bridge sign-in task: $taskName"

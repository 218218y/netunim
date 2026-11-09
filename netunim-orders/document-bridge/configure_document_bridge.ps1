param(
  [Parameter(Mandatory=$true)][string]$AppRoot,
  [string]$DraftPath
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# IMPORTANT: Keep this PowerShell source ASCII-only.
# Windows PowerShell 5.1 treats UTF-8 source without BOM as the active ANSI code page.
# Hebrew UI text is stored as UTF-8 Base64 and decoded at runtime so parsing is code-page independent.
function Decode-UiText([string]$Base64) {
  return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Base64))
}

$configPath = Join-Path $AppRoot 'config.json'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Config {
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return [pscustomobject]@{} }
  try {
    $raw = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($raw)) { return [pscustomobject]@{} }
    return ($raw | ConvertFrom-Json)
  } catch {
    throw ((Decode-UiText '15zXkCDXoNeZ16rXnyDXnNen16jXldeQINeQ16ogY29uZmlnLmpzb246IA==') + $_.Exception.Message)
  }
}

function Existing-Roots($config) {
  $values = New-Object System.Collections.Generic.List[string]
  if ($config.PSObject.Properties.Name -contains 'roots' -and $config.roots) {
    foreach ($item in @($config.roots)) {
      $value = if ($item -is [string]) { [string]$item } elseif ($item -and $item.PSObject.Properties.Name -contains 'path') { [string]$item.path } else { '' }
      $value = $value.Trim().Trim('"')
      if ($value -and -not $values.Contains($value)) { $values.Add($value) }
    }
  }
  return $values
}

function Save-Roots($config, [string[]]$roots) {
  $rows = @($roots | ForEach-Object { [pscustomobject]@{ path = $_ } })
  if ($config.PSObject.Properties.Name -contains 'roots') { $config.roots = $rows }
  else { $config | Add-Member -NotePropertyName roots -NotePropertyValue $rows }
  $driveScope = @($roots | Where-Object { $_ -match '^[a-z]:\\$' }).Count -gt 0
  $config | Add-Member -Force -NotePropertyName allowDriveRoots -NotePropertyValue $driveScope
  $json = $config | ConvertTo-Json -Depth 8
  [System.IO.Directory]::CreateDirectory($AppRoot) | Out-Null
  $destination = if ($DraftPath) { $DraftPath } else { $configPath }
  $temporary = "$destination.$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    [IO.File]::WriteAllText($temporary, $json + [Environment]::NewLine, $utf8NoBom)
    if ([IO.File]::Exists($destination)) {
      $backup = "$temporary.previous"
      [IO.File]::Replace($temporary, $destination, $backup)
      [IO.File]::Delete($backup)
    } else {
      [IO.File]::Move($temporary, $destination)
    }
  } finally {
    [IO.File]::Delete($temporary)
  }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = Decode-UiText '15TXkteT16jXqiDXl9eZ16TXldepINen15HXpteZ150g15HXnteX16nXkQ=='
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(720, 530)
$form.MinimumSize = $form.Size
$form.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$form.RightToLeftLayout = $true
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.MaximizeBox = $false

$title = New-Object System.Windows.Forms.Label
$title.Text = (Decode-UiText '15HXl9eZ16jXqiDXqteZ16fXmdeV16og15XXm9eV16DXoNeZ150g15zXnteX15HXqCDXlNee16HXnteb15nXnQ==')
$title.AutoSize = $false
$title.Location = New-Object System.Drawing.Point(24, 20)
$title.Size = New-Object System.Drawing.Size(650, 28)
$title.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($title)

$help = New-Object System.Windows.Forms.Label
$help.Text = (Decode-UiText '15HXl9eoINeb157XlCDXqteZ16fXmdeV16osINeQ16og16rXmden15nXmdeqINeU157Xqdeq157XqSDXkNeVINeb15XXoNeg15nXnS4g16DXqteZ15HXmSDXntei16jXm9eqLCDXoNeq15XXoNeZINee15fXkdeo15nXnSDXlden15HXpteZ150g157Xldeh16rXqNeZ150g157XldeX16jXkteZ150u')
$help.AutoSize = $false
$help.Location = New-Object System.Drawing.Point(24, 52)
$help.Size = New-Object System.Drawing.Size(650, 48)
$form.Controls.Add($help)

$list = New-Object System.Windows.Forms.ListBox
$list.Location = New-Object System.Drawing.Point(24, 108)
$list.Size = New-Object System.Drawing.Size(650, 205)
$list.Anchor = 'Top,Bottom,Left,Right'
$list.HorizontalScrollbar = $true
$list.RightToLeft = [System.Windows.Forms.RightToLeft]::No
$form.Controls.Add($list)

$config = Read-Config
foreach ($root in (Existing-Roots $config)) { [void]$list.Items.Add($root) }

$pathBox = New-Object System.Windows.Forms.TextBox
$pathBox.Location = New-Object System.Drawing.Point(24, 326)
$pathBox.Size = New-Object System.Drawing.Size(430, 28)
$pathBox.Anchor = 'Bottom,Left,Right'
$pathBox.RightToLeft = [System.Windows.Forms.RightToLeft]::No
$form.Controls.Add($pathBox)

$browse = New-Object System.Windows.Forms.Button
$browse.Text = Decode-UiText '15HXl9eoINeq15nXp9eZ15nXlC4uLg=='
$browse.Location = New-Object System.Drawing.Point(464, 324)
$browse.Size = New-Object System.Drawing.Size(105, 32)
$browse.Anchor = 'Bottom,Right'
$form.Controls.Add($browse)

$add = New-Object System.Windows.Forms.Button
$add.Text = Decode-UiText '15TXldeh16M='
$add.Location = New-Object System.Drawing.Point(579, 324)
$add.Size = New-Object System.Drawing.Size(95, 32)
$add.Anchor = 'Bottom,Right'
$form.Controls.Add($add)

$remove = New-Object System.Windows.Forms.Button
$remove.Text = Decode-UiText '15TXodeoINee16HXldee158='
$remove.Location = New-Object System.Drawing.Point(24, 370)
$remove.Size = New-Object System.Drawing.Size(110, 34)
$remove.Anchor = 'Bottom,Left'
$form.Controls.Add($remove)

$save = New-Object System.Windows.Forms.Button
$save.Text = Decode-UiText '16nXnteV16gg15XXlNee16nXmg=='
$save.Location = New-Object System.Drawing.Point(544, 370)
$save.Size = New-Object System.Drawing.Size(130, 36)
$save.Anchor = 'Bottom,Right'
$save.BackColor = [System.Drawing.Color]::FromArgb(58, 104, 78)
$save.ForeColor = [System.Drawing.Color]::White
$save.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$form.Controls.Add($save)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = Decode-UiText '15HXmdeY15XXnA=='
$cancel.Location = New-Object System.Drawing.Point(434, 370)
$cancel.Size = New-Object System.Drawing.Size(100, 36)
$cancel.Anchor = 'Bottom,Right'
$form.Controls.Add($cancel)

function Get-SelectablePath([string]$candidate) {
  if ($candidate -notmatch '^(?:[a-z]:[\\/]|\\\\[^?.\\])') { return }
  try { $directory = Get-Item -LiteralPath $candidate -Force -ErrorAction Stop } catch { return }
  if ($directory -isnot [IO.DirectoryInfo]) { return }
  $systemNames = @('Windows','Program Files','Program Files (x86)','ProgramData','WindowsApps','WpSystem','System Volume Information','$Recycle.Bin','Recovery','PerfLogs')
  $privateNames = @('AppData','NetunimDocumentBridge','NetunimKupaBankBridge','NetunimSecurity')
  $protected = @($AppRoot,$env:WINDIR,$env:ProgramData,$env:ProgramFiles,${env:ProgramFiles(x86)},$env:LOCALAPPDATA,$env:APPDATA)
  for ($part = $directory; $part.Parent; $part = $part.Parent) {
    if ($part.Name.StartsWith('.') -or $part.Name -in $privateNames -or $part.FullName -in $protected) { return }
    if ($null -eq $part.Parent.Parent -and $part.Name -in $systemNames) { return }
    if ($part.Attributes -band ([IO.FileAttributes]::Hidden -bor [IO.FileAttributes]::System)) { return }
  }
  return $directory.FullName
}

function Add-Path([string]$candidate) {
  $candidate = ([string]$candidate).Trim().Trim('"')
  if (-not $candidate) { return }
  $selectedPath = Get-SelectablePath $candidate
  if (-not $selectedPath) {
    $message = (Decode-UiText '15TXqteZ16fXmdeZ15Qg15DXmdeg15Qg15bXnteZ16DXlCDXkNeVINeg157XpteQ16og15HXkNeW15XXqCDXnteV15LXny4=') + [Environment]::NewLine + $candidate
    [System.Windows.Forms.MessageBox]::Show($form, $message, (Decode-UiText '16rXmden15nXmdeUINec15Ag15bXnteZ16DXlA=='), 'OK', 'Warning') | Out-Null
    return
  }
  $candidate = $selectedPath
  foreach ($item in $list.Items) { if ([string]::Equals([string]$item, $candidate, [System.StringComparison]::OrdinalIgnoreCase)) { $pathBox.Clear(); return } }
  [void]$list.Items.Add($candidate)
  $pathBox.Clear()
}

$browse.Add_Click({
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = Decode-UiText '15HXl9eoINeq15nXp9eZ15nXlCDXnNeX15nXpNeV16k='
  $dialog.ShowNewFolderButton = $false
  if ($list.Items.Count -gt 0) { $dialog.SelectedPath = [string]$list.Items[0] }
  if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) { Add-Path $dialog.SelectedPath }
  $dialog.Dispose()
})
$add.Add_Click({ Add-Path $pathBox.Text })
$pathBox.Add_KeyDown({ if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Enter) { $_.SuppressKeyPress = $true; Add-Path $pathBox.Text } })
$remove.Add_Click({ if ($list.SelectedIndex -ge 0) { $list.Items.RemoveAt($list.SelectedIndex) } })
$cancel.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel; $form.Close() })
$homeButton = New-Object System.Windows.Forms.Button
$homeButton.Text = (Decode-UiText '16rXmden15nXmdeqINeU157Xqdeq157XqQ==')
$homeButton.Location = New-Object System.Drawing.Point(24, 413)
$homeButton.Size = New-Object System.Drawing.Size(150, 34)
$homeButton.Anchor = 'Bottom,Left'
$homeButton.Add_Click({ Add-Path $env:USERPROFILE })
$form.Controls.Add($homeButton)

$drivesButton = New-Object System.Windows.Forms.Button
$drivesButton.Text = (Decode-UiText '15vXnCDXlNeb15XXoNeg15nXnSDXlNee16fXldee15nXmded')
$drivesButton.Location = New-Object System.Drawing.Point(185, 413)
$drivesButton.Size = New-Object System.Drawing.Size(195, 34)
$drivesButton.Anchor = 'Bottom,Left'
$drivesButton.Add_Click({
  foreach ($drive in [IO.DriveInfo]::GetDrives()) {
    if ($drive.IsReady -and $drive.DriveType -eq [IO.DriveType]::Fixed) { Add-Path $drive.RootDirectory.FullName }
  }
})
$form.Controls.Add($drivesButton)

$save.Add_Click({
  if ($list.Items.Count -lt 1) {
    [System.Windows.Forms.MessageBox]::Show($form, (Decode-UiText '15nXqSDXnNeU15XXodeZ16Mg15zXpNeX15XXqiDXqteZ16fXmdeZ15Qg15DXl9eqLg=='), (Decode-UiText '15fXodeo15Qg16rXmden15nXmdeU'), 'OK', 'Information') | Out-Null
    return
  }
  $selected = @($list.Items | ForEach-Object { Get-SelectablePath ([string]$_) })
  if ($selected.Count -ne $list.Items.Count) {
    [System.Windows.Forms.MessageBox]::Show($form, (Decode-UiText '15DXl9eqINeU15HXl9eZ16jXldeqINeQ15nXoNeUINeW157Xmdeg15Qg15DXlSDXnteV15LXoNeqLiDXlNeh16gg15DXldeq15Qg157XlNeo16nXmdee15Qg15XXkdeX16gg16rXmden15nXmdeUINeQ15fXqNeqLg=='), 'Document Bridge', 'OK', 'Warning') | Out-Null
    return
  }
  if (@($selected | Where-Object { $_ -match '^[a-z]:\\$' }).Count -gt 0) {
    $choice = [System.Windows.Forms.MessageBox]::Show($form, (Decode-UiText '15HXl9eZ16jXlCDXkdeQ15XXnNeV16og15zXl9eZ16TXldepINeU15zXkCDXnteQ16TXqdeo16og15zXkNeq16gg15zXpNeq15XXlyDXldeU16LXmdeR16gg16fXkdem15nXnSDXnNeh15wg15TXnteZ15fXlteV16guINec16nXnteV16gg15DXqiDXlNeR15fXmdeo15Q/'), 'Document Bridge', 'YesNo', 'Warning', 'Button2')
    if ($choice -ne [System.Windows.Forms.DialogResult]::Yes) { return }
  }
  try { Save-Roots $config $selected } catch {
    [System.Windows.Forms.MessageBox]::Show($form, ($_.Exception.Message), 'Document Bridge', 'OK', 'Error') | Out-Null
    return
  }
  $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.Close()
})

$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) { exit 1 }
exit 0

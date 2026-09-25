param(
  [Parameter(Mandatory=$true)][string]$AppRoot,
  [switch]$FirstRun
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$configPath = Join-Path $AppRoot 'config.json'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Read-Config {
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return [pscustomobject]@{} }
  try {
    $raw = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($raw)) { return [pscustomobject]@{} }
    return ($raw | ConvertFrom-Json)
  } catch {
    throw "לא ניתן לקרוא את config.json: $($_.Exception.Message)"
  }
}

function Existing-Roots($config) {
  $values = New-Object System.Collections.Generic.List[string]
  if ($config.PSObject.Properties.Name -contains 'roots' -and $config.roots) {
    foreach ($item in @($config.roots)) {
      $value = if ($item -is [string]) { [string]$item } elseif ($item.PSObject.Properties.Name -contains 'path') { [string]$item.path } else { '' }
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
  $json = $config | ConvertTo-Json -Depth 8
  [System.IO.Directory]::CreateDirectory($AppRoot) | Out-Null
  [System.IO.File]::WriteAllText($configPath, $json + [Environment]::NewLine, $utf8NoBom)
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'הגדרת חיפוש מסמכים במחשב'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(720, 500)
$form.MinimumSize = New-Object System.Drawing.Size(650, 430)
$form.RightToLeft = [System.Windows.Forms.RightToLeft]::Yes
$form.RightToLeftLayout = $true
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.MaximizeBox = $false

$title = New-Object System.Windows.Forms.Label
$title.Text = 'בחר את התיקיות שבהן נמצאים קבצי ה-PDF'
$title.AutoSize = $false
$title.Location = New-Object System.Drawing.Point(24, 20)
$title.Size = New-Object System.Drawing.Size(650, 28)
$title.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($title)

$help = New-Object System.Windows.Forms.Label
$help.Text = 'אפשר לבחור תיקייה מקומית, תיקיית Drive או כונן רשת ממופה. אפשר להוסיף יותר מתיקייה אחת. כל מחשב נשמר בנפרד.'
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
$browse.Text = 'בחר תיקייה...'
$browse.Location = New-Object System.Drawing.Point(464, 324)
$browse.Size = New-Object System.Drawing.Size(105, 32)
$browse.Anchor = 'Bottom,Right'
$form.Controls.Add($browse)

$add = New-Object System.Windows.Forms.Button
$add.Text = 'הוסף'
$add.Location = New-Object System.Drawing.Point(579, 324)
$add.Size = New-Object System.Drawing.Size(95, 32)
$add.Anchor = 'Bottom,Right'
$form.Controls.Add($add)

$remove = New-Object System.Windows.Forms.Button
$remove.Text = 'הסר מסומן'
$remove.Location = New-Object System.Drawing.Point(24, 370)
$remove.Size = New-Object System.Drawing.Size(110, 34)
$remove.Anchor = 'Bottom,Left'
$form.Controls.Add($remove)

$save = New-Object System.Windows.Forms.Button
$save.Text = 'שמור והמשך'
$save.Location = New-Object System.Drawing.Point(544, 370)
$save.Size = New-Object System.Drawing.Size(130, 36)
$save.Anchor = 'Bottom,Right'
$save.BackColor = [System.Drawing.Color]::FromArgb(58, 104, 78)
$save.ForeColor = [System.Drawing.Color]::White
$save.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$form.Controls.Add($save)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = 'ביטול'
$cancel.Location = New-Object System.Drawing.Point(434, 370)
$cancel.Size = New-Object System.Drawing.Size(100, 36)
$cancel.Anchor = 'Bottom,Right'
$form.Controls.Add($cancel)

function Add-Path([string]$candidate) {
  $candidate = ([string]$candidate).Trim().Trim('"')
  if (-not $candidate) { return }
  if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
    [System.Windows.Forms.MessageBox]::Show($form, "התיקייה אינה זמינה כרגע:`n$candidate`n`nודא שהכונן/Drive מחובר ונסה שוב.", 'תיקייה לא זמינה', 'OK', 'Warning') | Out-Null
    return
  }
  foreach ($item in $list.Items) { if ([string]::Equals([string]$item, $candidate, [System.StringComparison]::OrdinalIgnoreCase)) { $pathBox.Clear(); return } }
  [void]$list.Items.Add($candidate)
  $pathBox.Clear()
}

$browse.Add_Click({
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'בחר תיקיית PDF לחיפוש'
  $dialog.ShowNewFolderButton = $false
  if ($list.Items.Count -gt 0) { $dialog.SelectedPath = [string]$list.Items[0] }
  if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) { Add-Path $dialog.SelectedPath }
  $dialog.Dispose()
})
$add.Add_Click({ Add-Path $pathBox.Text })
$pathBox.Add_KeyDown({ if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Enter) { $_.SuppressKeyPress = $true; Add-Path $pathBox.Text } })
$remove.Add_Click({ if ($list.SelectedIndex -ge 0) { $list.Items.RemoveAt($list.SelectedIndex) } })
$cancel.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel; $form.Close() })
$save.Add_Click({
  if ($list.Items.Count -lt 1) {
    [System.Windows.Forms.MessageBox]::Show($form, 'יש להוסיף לפחות תיקייה אחת.', 'חסרה תיקייה', 'OK', 'Information') | Out-Null
    return
  }
  $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.Close()
})

$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  if ($FirstRun -and $list.Items.Count -eq 0) { exit 2 }
  exit 1
}

$selected = @($list.Items | ForEach-Object { [string]$_ })
Save-Roots $config $selected
[System.Windows.Forms.MessageBox]::Show($form, "נשמרו $($selected.Count) תיקיות לחיפוש.", 'Document Bridge', 'OK', 'Information') | Out-Null
exit 0

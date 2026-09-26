param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$source = [string]$env:NETUNIM_PREVIEW_SOURCE
$output = [string]$env:NETUNIM_PREVIEW_OUTPUT
$kind = [string]$env:NETUNIM_PREVIEW_KIND

if ([string]::IsNullOrWhiteSpace($source)) { throw 'NETUNIM_PREVIEW_SOURCE is required.' }
if ([string]::IsNullOrWhiteSpace($output)) { throw 'NETUNIM_PREVIEW_OUTPUT is required.' }
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Preview source does not exist: $source" }

$parent = Split-Path -Parent $output
if ($parent) { [System.IO.Directory]::CreateDirectory($parent) | Out-Null }
if (Test-Path -LiteralPath $output) { Remove-Item -Force -LiteralPath $output }

function Release-ComObject($value) {
  if ($null -ne $value -and [Runtime.InteropServices.Marshal]::IsComObject($value)) {
    try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($value) } catch {}
  }
}

switch ($kind) {
  'word' {
    $app = $null
    $doc = $null
    try {
      $app = New-Object -ComObject Word.Application
      $app.Visible = $false
      $app.DisplayAlerts = 0
      try { $app.AutomationSecurity = 3 } catch {}
      $doc = $app.Documents.Open($source, $false, $true, $false)
      $doc.ExportAsFixedFormat($output, 17)
    } finally {
      if ($null -ne $doc) { try { $doc.Close(0) } catch {}; Release-ComObject $doc }
      if ($null -ne $app) { try { $app.Quit() } catch {}; Release-ComObject $app }
    }
  }
  'excel' {
    $app = $null
    $book = $null
    try {
      $app = New-Object -ComObject Excel.Application
      $app.Visible = $false
      $app.DisplayAlerts = $false
      try { $app.AutomationSecurity = 3 } catch {}
      $book = $app.Workbooks.Open($source, 0, $true)
      $book.ExportAsFixedFormat(0, $output)
    } finally {
      if ($null -ne $book) { try { $book.Close($false) } catch {}; Release-ComObject $book }
      if ($null -ne $app) { try { $app.Quit() } catch {}; Release-ComObject $app }
    }
  }
  'powerpoint' {
    $app = $null
    $deck = $null
    try {
      $app = New-Object -ComObject PowerPoint.Application
      try { $app.AutomationSecurity = 3 } catch {}
      $deck = $app.Presentations.Open($source, -1, 0, 0)
      $deck.SaveAs($output, 32)
    } finally {
      if ($null -ne $deck) { try { $deck.Close() } catch {}; Release-ComObject $deck }
      if ($null -ne $app) { try { $app.Quit() } catch {}; Release-ComObject $app }
    }
  }
  default { throw "Unsupported Office preview kind: $kind" }
}

if (-not (Test-Path -LiteralPath $output -PathType Leaf)) { throw 'Office preview conversion did not create a PDF.' }
$item = Get-Item -LiteralPath $output
if ($item.Length -lt 16) { throw 'Office preview conversion created an empty PDF.' }
Write-Output ('OK ' + $item.Length)

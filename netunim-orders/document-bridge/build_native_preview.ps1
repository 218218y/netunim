param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Output
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Preview host source not found: $Source" }
$parent = Split-Path -Parent $Output
if ($parent) { [System.IO.Directory]::CreateDirectory($parent) | Out-Null }
if (Test-Path -LiteralPath $Output) { Remove-Item -Force -LiteralPath $Output }

$candidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$csc = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $csc) { throw 'Microsoft .NET Framework C# compiler (csc.exe) was not found.' }

& $csc /nologo /optimize+ /target:exe /platform:anycpu /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll /out:$Output $Source
if ($LASTEXITCODE -ne 0) { throw "Native preview host compilation failed with exit code $LASTEXITCODE." }
if (-not (Test-Path -LiteralPath $Output -PathType Leaf)) { throw 'Native preview host executable was not created.' }
Write-Host "Built Windows Preview Handler host: $Output"

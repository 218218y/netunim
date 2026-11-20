param([Parameter(Mandatory=$true)][string]$OutputDirectory)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
Add-Type -LiteralPath (Join-Path $PSScriptRoot 'bank_bridge_dpapi.cs') -ReferencedAssemblies 'System.Security.dll' `
  -OutputType ConsoleApplication -OutputAssembly (Join-Path $OutputDirectory 'BankBridgeDpapi.exe')

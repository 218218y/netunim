param([Parameter(Mandatory=$true)][string]$AppRoot)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$version = '24.21.0'
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($arch -ne 'x64') { throw "Unsupported Windows architecture for pinned Document Bridge Node runtime: $arch" }

$asset = "node-v$version-win-x64.zip"
$runtimePrefix = "node-v$version-win-x64-"
$pointerPath = Join-Path $AppRoot 'node-runtime.txt'
$downloadUrl = "https://nodejs.org/download/release/v$version/$asset"
$expectedArchiveSha256 = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'
$expectedNodeSha256 = 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32'
$logPath = Join-Path $AppRoot 'install-node.log'

function Write-InstallLog([string]$Message) {
  Add-Content -LiteralPath $logPath -Value (('{0:o} {1}' -f (Get-Date), $Message)) -Encoding UTF8
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-RuntimeName([string]$Name) {
  return $Name -match ('^' + [regex]::Escape($runtimePrefix) + '[0-9]{8}-[0-9]{6}-[0-9]+-[0-9a-f]{8}$')
}

function Assert-NodeBinary([string]$NodePath) {
  if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Pinned Node executable is missing: $NodePath" }
  $actualHash = Get-Sha256 $NodePath
  if ($actualHash -ne $expectedNodeSha256) {
    throw "SHA-256 mismatch for $NodePath. Expected $expectedNodeSha256 but got $actualHash"
  }
  # Do not pipe a native process into Select-Object before reading its exit code.
  # Windows PowerShell can leave $LASTEXITCODE unset/stale for native commands
  # on the left side of a pipeline, which previously rejected a valid Node that
  # had already printed the exact pinned version. Capture stdout directly, save
  # the native exit code immediately, and only then inspect the first line.
  $reportedLines = @(& $NodePath -p 'process.versions.node' 2>$null)
  $nodeExitCode = $LASTEXITCODE
  $reported = if ($reportedLines.Count -gt 0) { ([string]$reportedLines[0]).Trim() } else { '' }
  if ($nodeExitCode -ne 0) {
    throw "Pinned Node executable version probe failed with exit code $nodeExitCode. Output: $reported"
  }
  if ($reported -ne $version) {
    throw "Pinned Node executable reported an unexpected version. Expected $version but got '$reported'"
  }
}

function Test-NodeRuntime([string]$RuntimeDirectory) {
  try {
    if (-not (Test-Path -LiteralPath $RuntimeDirectory -PathType Container)) { return $false }
    Assert-NodeBinary (Join-Path $RuntimeDirectory 'node.exe')
    return $true
  } catch {
    Write-InstallLog "Private Node runtime verification failed for $RuntimeDirectory : $($_.Exception.Message)"
    return $false
  }
}

function Assert-ArchiveHash([string]$ArchivePath) {
  $actual = Get-Sha256 $ArchivePath
  if ($actual -ne $expectedArchiveSha256) {
    throw "SHA-256 mismatch for $ArchivePath. Expected $expectedArchiveSha256 but got $actual"
  }
  Write-InstallLog "Verified Node archive SHA-256 for $ArchivePath"
}

function Extract-NodeExecutable([string]$ArchivePath, [string]$DestinationPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $entryName = "node-v$version-win-x64/node.exe"
    $entry = @($zip.Entries | Where-Object { $_.FullName -eq $entryName }) | Select-Object -First 1
    if (-not $entry) { throw "Verified Node archive does not contain $entryName" }
    $input = $entry.Open()
    try {
      $output = [System.IO.File]::Create($DestinationPath)
      try { $input.CopyTo($output) } finally { $output.Dispose() }
    } finally { $input.Dispose() }
  } finally { $zip.Dispose() }
}

function Remove-FileBestEffort([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  try {
    if ([System.IO.File]::Exists($Path)) { [System.IO.File]::Delete($Path) }
  } catch {
    Write-InstallLog "Cleanup warning for file $Path : $($_.Exception.Message)"
  }
}

function Remove-DirectoryTreeBestEffort([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return }
  try {
    if ([System.IO.Directory]::Exists($Path)) { [System.IO.Directory]::Delete($Path, $true) }
  } catch {
    Write-InstallLog "Cleanup warning for directory $Path : $($_.Exception.Message)"
  }
}

function Download-WithTimeout([string]$Url, [string]$Destination, [int]$TimeoutSec) {
  if ([System.IO.File]::Exists($Destination)) { [System.IO.File]::Delete($Destination) }
  $oldSecurityProtocol = [Net.ServicePointManager]::SecurityProtocol
  try {
    [Net.ServicePointManager]::SecurityProtocol = $oldSecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination -TimeoutSec $TimeoutSec -MaximumRedirection 8
  } finally {
    [Net.ServicePointManager]::SecurityProtocol = $oldSecurityProtocol
  }
}

[System.IO.Directory]::CreateDirectory($AppRoot) | Out-Null
Write-InstallLog "Starting private Node install/verify. Version=$version Arch=$arch Asset=$asset"

if (Test-Path -LiteralPath $pointerPath -PathType Leaf) {
  $currentName = ([string](Get-Content -LiteralPath $pointerPath -Raw -Encoding UTF8)).Trim()
  if ((Test-RuntimeName $currentName) -and (Test-NodeRuntime (Join-Path $AppRoot $currentName))) {
    Write-InstallLog "Existing private Node runtime verified: $currentName"
    Write-Output (Join-Path (Join-Path $AppRoot $currentName) 'node.exe')
    exit 0
  }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$random = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$runtimeName = $runtimePrefix + $stamp + '-' + $PID + '-' + $random
$runtimeDirectory = Join-Path $AppRoot $runtimeName
$tempDirectory = Join-Path $AppRoot ('node-runtime-staging-' + [Guid]::NewGuid().ToString('N'))
$tempNode = Join-Path $tempDirectory 'node.exe'
$tempPointer = Join-Path $AppRoot ('node-runtime.new.' + [Guid]::NewGuid().ToString('N') + '.txt')
$downloadDirectory = Join-Path $AppRoot ('node-download-staging-' + [Guid]::NewGuid().ToString('N'))
$downloadPath = Join-Path $downloadDirectory $asset

try {
  [System.IO.Directory]::CreateDirectory($tempDirectory) | Out-Null
  [System.IO.Directory]::CreateDirectory($downloadDirectory) | Out-Null

  $archivePath = $null
  $localCandidates = New-Object System.Collections.Generic.List[string]
  $localCandidates.Add((Join-Path $PSScriptRoot $asset))
  if ($env:USERPROFILE) { $localCandidates.Add((Join-Path (Join-Path $env:USERPROFILE 'Downloads') $asset)) }
  $localCandidates.Add((Join-Path (Join-Path $AppRoot 'downloads') $asset))

  foreach ($candidate in $localCandidates) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    Write-Host "Found local $asset; verifying it before install..."
    Write-InstallLog "Trying local Node archive: $candidate"
    try {
      Assert-ArchiveHash $candidate
      $archivePath = $candidate
      break
    } catch {
      Write-Warning "Local Node archive was rejected: $($_.Exception.Message)"
      Write-InstallLog "Rejected local Node archive $candidate : $($_.Exception.Message)"
    }
  }

  if (-not $archivePath) {
    $timeoutSec = 35
    Write-Host "Downloading official Node.js $version ($arch)..."
    Write-InstallLog "Downloading Node from $downloadUrl with timeout ${timeoutSec}s"
    try {
      Download-WithTimeout $downloadUrl $downloadPath $timeoutSec
      Assert-ArchiveHash $downloadPath
      $archivePath = $downloadPath
    } catch {
      $manualUrl = "https://nodejs.org/download/release/v$version/"
      throw @"
Automatic Node.js download failed: $($_.Exception.Message)
Manual install path (fully supported):
1. Download exactly: $asset
2. Official release directory: $manualUrl
3. Put $asset next to install_document_bridge.bat (or leave it in Downloads).
4. Run install_document_bridge.bat again. The installer will verify SHA-256 before using it.
Expected archive SHA-256: $expectedArchiveSha256
Diagnostics: $logPath
"@
    }
  }

  Write-InstallLog "Extracting node.exe from verified archive: $archivePath"
  Extract-NodeExecutable $archivePath $tempNode
  Write-InstallLog "Extracted node.exe; verifying pinned SHA-256 and runtime version."
  Assert-NodeBinary $tempNode
  Write-InstallLog "Verified extracted node.exe SHA-256 and runtime version."

  Move-Item -LiteralPath $tempDirectory -Destination $runtimeDirectory
  if (-not (Test-NodeRuntime $runtimeDirectory)) { throw 'Private Node.js runtime failed verification after activation.' }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($tempPointer, $runtimeName + [Environment]::NewLine, $utf8NoBom)
  Move-Item -LiteralPath $tempPointer -Destination $pointerPath -Force
  Write-InstallLog "Activated private Node runtime: $runtimeName"
  Write-Output (Join-Path $runtimeDirectory 'node.exe')
} catch {
  Write-InstallLog "Private Node install failed before cleanup: $($_.Exception.GetType().FullName): $($_.Exception.Message)"
  throw
} finally {
  # Windows PowerShell's FileSystem provider is known to fail Remove-Item on some
  # 8.3 TEMP paths (common with Unicode account names). Keep installer scratch
  # under AppRoot and use System.IO cleanup so cleanup can never mask a verified
  # install or the original installation error.
  Remove-FileBestEffort $tempPointer
  Remove-DirectoryTreeBestEffort $tempDirectory
  Remove-DirectoryTreeBestEffort $downloadDirectory
}

param([Parameter(Mandatory=$true)][string]$AppRoot)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$version = '1.1.0.38'
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()

switch ($arch) {
  'x64' {
    $asset = "ES-$version.x64.zip"
    $expectedSha256 = '5e0c70cbf4f694080c34aa7c6c745e606c16fe76a4b5423b93ebf9dc34274c99'
  }
  'arm64' {
    $asset = "ES-$version.ARM64.zip"
    $expectedSha256 = '86eddd4ae8925833e33be1d09e7faa2442110d00daf0e48a8e963cdeb7a141fe'
  }
  default { throw "Unsupported Windows architecture for pinned ES: $arch" }
}

$tools = Join-Path $AppRoot 'tools'
$es = Join-Path $tools 'es.exe'
$logPath = Join-Path $AppRoot 'install-es.log'
New-Item -ItemType Directory -Force -Path $AppRoot | Out-Null
New-Item -ItemType Directory -Force -Path $tools | Out-Null

function Write-InstallLog([string]$message) {
  $line = ('{0:o} {1}' -f (Get-Date), $message)
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Get-EsVersion([string]$exePath) {
  if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) { return $null }
  $line = (& $exePath -version 2>$null | Select-Object -First 1)
  if ($null -eq $line) { return $null }
  return ([string]$line).Trim()
}

function Assert-EsBinary([string]$exePath) {
  $actualVersion = Get-EsVersion $exePath
  if ($actualVersion -ne $version) {
    throw "Expected ES $version but found '$actualVersion' in $exePath"
  }

  # The official release archive is pinned by its SHA-256 pinned from the official GitHub release metadata below.
  # Keep Authenticode as an additional signal when present, but do not make an
  # offline install depend on Windows being able to build a certificate chain.
  $signature = Get-AuthenticodeSignature -FilePath $exePath
  if ($signature.Status -eq 'Valid') {
    $subject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { '' }
    if ($subject -notmatch '(?i)voidtools|David Carpenter') {
      throw "Unexpected ES Authenticode signer: $subject"
    }
    Write-InstallLog "Verified ES Authenticode signature: $subject"
  } else {
    Write-InstallLog "ES Authenticode status is $($signature.Status); archive SHA-256 remains authoritative for this pinned release."
  }

  return $actualVersion
}

function Assert-ArchiveHash([string]$archivePath) {
  $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expectedSha256) {
    throw "SHA-256 mismatch for $archivePath. Expected $expectedSha256 but got $actual"
  }
  Write-InstallLog "Verified archive SHA-256 for $archivePath"
}

function Install-FromArchive([string]$archivePath, [string]$scratchRoot) {
  Assert-ArchiveHash $archivePath
  $extractDir = Join-Path $scratchRoot ('extract-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $extractDir | Out-Null
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir -Force
  $downloaded = Get-ChildItem -LiteralPath $extractDir -Filter es.exe -File -Recurse | Select-Object -First 1
  if (-not $downloaded) { throw 'Verified ES archive did not contain es.exe' }
  $downloadedVersion = Assert-EsBinary $downloaded.FullName
  Copy-Item -Force -LiteralPath $downloaded.FullName -Destination $es
  $installedVersion = Assert-EsBinary $es
  if ($installedVersion -ne $downloadedVersion) { throw 'ES copy verification failed after installation.' }
  Write-Host "Installed verified ES $installedVersion to $es"
  Write-InstallLog "Installed ES $installedVersion to $es"
}

function Download-WithTimeout([string]$url, [string]$destination, [int]$timeoutSec) {
  if (Test-Path -LiteralPath $destination) { Remove-Item -Force -LiteralPath $destination }

  # Windows PowerShell 5.1 can otherwise negotiate legacy TLS defaults on some PCs.
  $oldSecurityProtocol = [Net.ServicePointManager]::SecurityProtocol
  try {
    [Net.ServicePointManager]::SecurityProtocol = $oldSecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $destination -TimeoutSec $timeoutSec -MaximumRedirection 8
  } finally {
    [Net.ServicePointManager]::SecurityProtocol = $oldSecurityProtocol
  }
}

Write-InstallLog "Starting ES install/verify. Version=$version Arch=$arch Asset=$asset"

if (Test-Path -LiteralPath $es -PathType Leaf) {
  try {
    $installed = Assert-EsBinary $es
    if ($installed -eq $version) {
      Write-Host "Pinned ES $version is already installed."
      Write-InstallLog 'Existing ES installation verified; no download required.'
      exit 0
    }
  } catch {
    Write-InstallLog "Existing ES verification failed; replacing it. $($_.Exception.Message)"
  }
}

$tmp = Join-Path $env:TEMP ('netunim-es-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
  # A manually downloaded official archive is deliberately preferred over the
  # network. This makes filtered/offline PCs deterministic and still secure
  # because the exact release SHA-256 is verified before extraction.
  $localCandidates = New-Object System.Collections.Generic.List[string]
  $localCandidates.Add((Join-Path $PSScriptRoot $asset))
  if ($env:USERPROFILE) { $localCandidates.Add((Join-Path (Join-Path $env:USERPROFILE 'Downloads') $asset)) }
  $localCandidates.Add((Join-Path (Join-Path $AppRoot 'downloads') $asset))

  foreach ($candidate in $localCandidates) {
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
    Write-Host "Found local $asset; verifying it before install..."
    Write-InstallLog "Trying local ES archive: $candidate"
    try {
      Install-FromArchive $candidate $tmp
      exit 0
    } catch {
      Write-Warning "Local ES archive was rejected: $($_.Exception.Message)"
      Write-InstallLog "Rejected local ES archive $candidate : $($_.Exception.Message)"
    }
  }

  $downloadPath = Join-Path $tmp $asset
  $sources = @(
    "https://github.com/voidtools/ES/releases/download/$version/$asset",
    "https://www.voidtools.com/$asset",
    "https://ftp.voidtools.com/$asset"
  )
  $timeoutSec = 20
  $errors = New-Object System.Collections.Generic.List[string]

  Write-Host "Downloading official voidtools ES $version ($arch)..."
  Write-Host "Each source is limited to $timeoutSec seconds; the installer will not wait indefinitely."

  foreach ($url in $sources) {
    Write-Host "  Trying $url"
    Write-InstallLog "Downloading ES from $url with timeout ${timeoutSec}s"
    try {
      Download-WithTimeout $url $downloadPath $timeoutSec
      Assert-ArchiveHash $downloadPath
      Install-FromArchive $downloadPath $tmp
      exit 0
    } catch {
      $message = $_.Exception.Message
      $errors.Add("$url -> $message")
      Write-Warning "Download source failed: $message"
      Write-InstallLog "Download source failed $url : $message"
      if (Test-Path -LiteralPath $downloadPath) { Remove-Item -Force -LiteralPath $downloadPath -ErrorAction SilentlyContinue }
    }
  }

  $manualUrl = "https://github.com/voidtools/ES/releases/tag/$version"
  $details = ($errors -join [Environment]::NewLine)
  $message = @"
Automatic ES download failed from all official sources.
This usually means a local web filter/proxy/TLS path is blocking one or more download hosts; it is not an Everything indexing error.

Manual install path (fully supported):
1. Download exactly: $asset
2. Official release page: $manualUrl
3. Put $asset next to install_document_bridge.bat (or leave it in your Downloads folder).
4. Run install_document_bridge.bat again. The installer will verify SHA-256 before using it.
Expected SHA-256: $expectedSha256

Diagnostics were written to: $logPath
Source errors:
$details
"@
  throw $message
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue -LiteralPath $tmp
}

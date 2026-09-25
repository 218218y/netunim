param([Parameter(Mandatory=$true)][string]$AppRoot)
$ErrorActionPreference = 'Stop'
$version = '1.1.0.38'
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
if ($arch -eq 'arm64') { $asset = "ES-$version.ARM64.zip" }
elseif ($arch -eq 'x64') { $asset = "ES-$version.x64.zip" }
else { throw "Unsupported Windows architecture for pinned ES: $arch" }
$tools = Join-Path $AppRoot 'tools'
$es = Join-Path $tools 'es.exe'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
if (Test-Path $es) {
  $installed = (& $es -version 2>$null | Select-Object -First 1).Trim()
  if ($installed -eq $version) { Write-Host "Pinned ES $version is already installed."; exit 0 }
}
$tmp = Join-Path $env:TEMP ("netunim-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $zip = Join-Path $tmp $asset
  $url = "https://ftp.voidtools.com/$asset"
  Write-Host "Downloading official voidtools ES $version ($arch)..."
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $downloaded = Get-ChildItem -Path $tmp -Filter es.exe -Recurse | Select-Object -First 1
  if (-not $downloaded) { throw 'Downloaded ES archive did not contain es.exe' }
  $signature = Get-AuthenticodeSignature -FilePath $downloaded.FullName
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'voidtools') {
    throw "ES Authenticode signature is not a valid voidtools signature: $($signature.Status) $($signature.SignerCertificate.Subject)"
  }
  $downloadedVersion = (& $downloaded.FullName -version 2>$null | Select-Object -First 1).Trim()
  if ($downloadedVersion -ne $version) { throw "Expected ES $version but downloaded $downloadedVersion" }
  Copy-Item -Force $downloaded.FullName $es
  Write-Host "Installed verified ES $downloadedVersion to $es"
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
}

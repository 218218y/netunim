param([ValidateSet('sandbox', 'vm')][string]$Kind = 'sandbox')
$ErrorActionPreference = 'Stop'
$PackagePath = 'C:\NetunimLabPackage'
$EvidencePath = 'C:\NetunimLabEvidence'
$runRoot = 'C:\NetunimLabRun'
$process = $null
try {
    $machine = Get-CimInstance Win32_ComputerSystem
    $virtual = $machine.Model -match 'Virtual Machine|VirtualBox|VMware|KVM|HVM|Parallels'
    if (-not $virtual) { throw 'This launcher requires an isolated virtual Windows guest.' }
    if ($Kind -eq 'sandbox' -and $env:USERNAME -ne 'WDAGUtilityAccount') { throw 'Sandbox identity is missing.' }
    if (Test-Path -LiteralPath $runRoot) { throw 'Guest lab directory already exists; use a clean guest or preserve and rename it first.' }
    $package = (Resolve-Path -LiteralPath $PackagePath).Path
    $evidence = (Resolve-Path -LiteralPath $EvidencePath).Path
    if (-not (Test-Path -LiteralPath (Join-Path $evidence 'lab-owner.json'))) { throw 'Evidence destination is not owned by the lab.' }
    if ($package -eq $evidence -or $evidence.StartsWith($package + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Evidence overlaps source.' }
    # Verify before copying; code is mapped read-only, with no host checkout/profile.
    & (Join-Path $package 'runtime\python\python.exe') -I (Join-Path $package 'source\tools\test_lab_package.py') --verify $package
    if ($LASTEXITCODE -ne 0) { throw 'Offline package verification failed.' }
    Copy-Item -LiteralPath $package -Destination $runRoot -Recurse
    @{kind=$Kind; virtual_machine=$virtual; model=$machine.Model} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runRoot 'guest-attestation.json') -Encoding UTF8
    $env:PATH = "$runRoot\runtime\node;$runRoot\runtime\git;$env:SystemRoot\System32;$env:SystemRoot"
    $env:GIT_CONFIG_NOSYSTEM = '1'
    $env:GIT_CONFIG_GLOBAL = 'NUL'
    $env:GIT_TERMINAL_PROMPT = '0'
    $env:PYTHONNOUSERSITE = '1'
    $env:PYTHONUTF8 = '1'
    Set-Location -LiteralPath (Join-Path $runRoot 'source')
    # A new local synthetic Git repository supports the existing evidence helpers.
    # Its commit is distinct from the original package source SHA recorded above.
    git -c init.templateDir= init -q
    if ($LASTEXITCODE -ne 0) { throw 'Guest Git initialization failed.' }
    git -c core.autocrlf=false add .
    if ($LASTEXITCODE -ne 0) { throw 'Guest Git snapshot failed.' }
    git -c user.name=NetunimLab -c user.email=lab@example.invalid -c commit.gpgsign=false commit -q -m 'Synthetic isolated lab snapshot'
    if ($LASTEXITCODE -ne 0) { throw 'Guest Git commit failed.' }
    $process = Start-Process -FilePath "$runRoot\runtime\python\python.exe" -ArgumentList @('-u', 'tools/test_lab.py', 'run', '--guest', '--scenario', 'isolation', '--scenario', 'local-save-abort', '--scenario', 'restore-and-crash', '--scenario', 'old-tab', '--scenario', 'bridge') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $evidence 'guest-output.txt') -RedirectStandardError (Join-Path $evidence 'guest-errors.txt')
    do {
        Start-Sleep -Seconds 3
        $reports = Join-Path $runRoot 'source\.work\test-lab'
        if (Test-Path -LiteralPath $reports) { Copy-Item -LiteralPath $reports -Destination $evidence -Recurse -Force }
        $process.Refresh()
    } while (-not $process.HasExited)
    $process.WaitForExit()
    @{complete=$true; exit_code=$process.ExitCode; kind=$Kind; physical_acceptance=$false} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $evidence 'guest-completion.json') -Encoding UTF8
} catch {
    $failure = @{complete=$false; status='BLOCKED'; message=$_.Exception.Message; physical_acceptance=$false}
    if (Test-Path -LiteralPath $EvidencePath) {
        $failure | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $EvidencePath 'guest-blocked.json') -Encoding UTF8
    }
    throw
}

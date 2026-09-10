@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0.."
if errorlevel 1 exit /b 2
set "TARGET=%~1"
set "MODE=%~2"
if /I not "%TARGET%"=="all" if /I not "%TARGET%"=="orders" if /I not "%TARGET%"=="kupa" exit /b 2
if not "%MODE%"=="" if /I not "%MODE%"=="--preflight-only" exit /b 2

echo Checking full GitHub verification for the exact local commit...
python "%~dp0github_verification.py"
if errorlevel 1 (
  echo ERROR: GitHub verification was not confirmed. No site was uploaded.
  exit /b 2
)
echo Checking public assets for unexpected files and secret markers...
python "%~dp0..\tests\deploy_preflight.py"
if errorlevel 1 exit /b 2

rem Both local-full and GitHub-full entrypoints authorize the same shared engine.
rem Fast deployment never calls the expensive local repository test runner.
set "NETUNIM_DEPLOY_VERIFIED=1"
rem Preflight every selected site before the first upload. The shared engine also
rem repeats its guards immediately before each individual upload.
call :selected_sites "--preflight-only"
if errorlevel 1 exit /b %ERRORLEVEL%
if /I "%MODE%"=="--preflight-only" exit /b 0
call :selected_sites ""
exit /b %ERRORLEVEL%

:selected_sites
if /I "%TARGET%"=="kupa" goto :kupa
call "%~dp0deploy_site_core.bat" "%~dp0..\netunim-orders" "bargig-orders" "orders-public-data-free-v1" "" "assets\app.js" "%~1"
if errorlevel 1 exit /b %ERRORLEVEL%
if /I "%TARGET%"=="orders" exit /b 0
:kupa
call "%~dp0deploy_site_core.bat" "%~dp0..\netunim-kupa" "bargig-kupa" "kupa-public-data-free-v1" "runtimeSelfCheck" "assets\js\lifecycle.js" "%~1"
exit /b %ERRORLEVEL%

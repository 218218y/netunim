@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

set "MODE=%~1"
if not "%MODE%"=="" if /I not "%MODE%"=="--preflight-only" exit /b 2

rem Standalone deployment keeps the repository-wide verifier as a hard gate.
if not exist "%~dp0..\verify.bat" (
  echo ERROR: repository verifier was not found: %~dp0..\verify.bat
  echo Keep both applications inside the netunim repository root.
  if /I not "%MODE%"=="--preflight-only" pause
  exit /b 2
)
echo Running full repository verification before deployment...
call "%~dp0..\verify.bat" --no-pause
if errorlevel 1 (
  echo.
  echo ERROR: verification failed. Deployment was cancelled before Wrangler started.
  if /I not "%MODE%"=="--preflight-only" pause
  exit /b 2
)

set "NETUNIM_DEPLOY_VERIFIED=1"
call "%~dp0..\tools\deploy_site_core.bat" "%~dp0" "bargig-kupa" "kupa-public-data-free-v1" "runtimeSelfCheck" "4.125.0" "assets\js\lifecycle.js" "%MODE%"
set "DEPLOY_EXIT=%ERRORLEVEL%"
if /I not "%MODE%"=="--preflight-only" pause
exit /b %DEPLOY_EXIT%

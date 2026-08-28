@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

set "MODE=%~1"
if not "%MODE%"=="" if /I not "%MODE%"=="--preflight-only" exit /b 2

rem One repository-wide verification gate for the pair. The per-site core below
rem still runs every site-specific deployment/security guard before each upload.
if not exist "%~dp0verify.bat" (
  echo ERROR: repository verifier was not found: %~dp0verify.bat
  if /I not "%MODE%"=="--preflight-only" pause
  exit /b 2
)
echo Running full repository verification once for both sites...
call "%~dp0verify.bat" --no-pause
if errorlevel 1 (
  echo.
  echo ERROR: verification failed. Neither site was deployed.
  if /I not "%MODE%"=="--preflight-only" pause
  exit /b 2
)

set "NETUNIM_DEPLOY_VERIFIED=1"
echo.
echo ============================================================
echo Orders deployment
echo ============================================================
call "%~dp0tools\deploy_site_core.bat" "%~dp0netunim-orders" "bargig-orders" "orders-public-data-free-v1" "" "assets\app.js" "%MODE%"
set "DEPLOY_EXIT=%ERRORLEVEL%"
if not "%DEPLOY_EXIT%"=="0" (
  echo.
  echo ERROR: orders deployment failed. Kupa deployment was not started.
  if /I not "%MODE%"=="--preflight-only" pause
  exit /b %DEPLOY_EXIT%
)

echo.
echo ============================================================
echo Kupa deployment
echo ============================================================
call "%~dp0tools\deploy_site_core.bat" "%~dp0netunim-kupa" "bargig-kupa" "kupa-public-data-free-v1" "runtimeSelfCheck" "assets\js\lifecycle.js" "%MODE%"
set "DEPLOY_EXIT=%ERRORLEVEL%"
if not "%DEPLOY_EXIT%"=="0" (
  echo.
  echo ERROR: Kupa deployment failed.
  if /I not "%MODE%"=="--preflight-only" pause
  exit /b %DEPLOY_EXIT%
)

echo.
if /I "%MODE%"=="--preflight-only" (
  echo Combined preflight completed successfully. No upload was requested.
  exit /b 0
)

echo Both sites were deployed successfully after one repository verification run.
pause
exit /b 0

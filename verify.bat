@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

set "NO_PAUSE="
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"
set "VERIFY_EXIT=0"

where py >nul 2>&1
if not errorlevel 1 (
  py -3 "%~dp0tests\run_all.py"
  if errorlevel 1 set "VERIFY_EXIT=1"
) else (
  where python >nul 2>&1
  if errorlevel 1 (
    echo ERROR: Python 3 was not found. Install Python 3.10 or newer and retry.
    set "VERIFY_EXIT=2"
  ) else (
    python "%~dp0tests\run_all.py"
    if errorlevel 1 set "VERIFY_EXIT=1"
  )
)

if not "%VERIFY_EXIT%"=="0" (
  echo.
  echo Verification failed. Nothing should be deployed until all checks pass.
) else (
  echo.
  echo Verification completed successfully.
)

if not defined NO_PAUSE pause
exit /b %VERIFY_EXIT%

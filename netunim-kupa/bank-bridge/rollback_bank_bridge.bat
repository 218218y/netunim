@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "SETUP=%~dp0setup_bank_bridge.ps1"
if exist "%~dp0setup\setup_bank_bridge.ps1" set "SETUP=%~dp0setup\setup_bank_bridge.ps1"
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SETUP%" -Mode Rollback
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%

@echo off
setlocal EnableExtensions DisableDelayedExpansion
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0setup_bank_bridge.ps1" -Mode Install
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%

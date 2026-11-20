@echo off
setlocal EnableExtensions DisableDelayedExpansion
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0bank_bridge_autostart.ps1" -Mode Remove
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%

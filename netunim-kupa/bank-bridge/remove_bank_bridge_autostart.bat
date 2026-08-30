@echo off
setlocal
set "AUTOSTART=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NetunimKupaBankBridge.vbs"
if exist "%AUTOSTART%" del /q "%AUTOSTART%"
echo Bank Bridge autostart entry removed. Encrypted credentials were left untouched.
pause

@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "APPROOT=%LOCALAPPDATA%\NetunimDocumentBridge"
set "CONFIGURATOR=%~dp0configure_document_bridge.ps1"
if exist "%CONFIGURATOR%" goto :configure

rem The installed shortcut resolves the configuration UI from the active app.
set "ACTIVEFILE=%APPROOT%\active-runtime.txt"
set "RUNTIMENAME="
if not exist "%ACTIVEFILE%" goto :missing
set /p "RUNTIMENAME="<"%ACTIVEFILE%"
if /I not "%RUNTIMENAME:~0,5%"=="app-v" goto :missing
if not "%RUNTIMENAME:\=%"=="%RUNTIMENAME%" goto :missing
if not "%RUNTIMENAME:/=%"=="%RUNTIMENAME%" goto :missing
if not "%RUNTIMENAME:..=%"=="%RUNTIMENAME%" goto :missing
set "CONFIGURATOR=%APPROOT%\%RUNTIMENAME%\configure_document_bridge.ps1"
if not exist "%CONFIGURATOR%" goto :missing

:configure
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%CONFIGURATOR%" -AppRoot "%APPROOT%"
exit /b %ERRORLEVEL%

:missing
echo The installed folder picker was not found.
echo Run configure_document_bridge.bat from the updated repository, or run install_document_bridge.bat.
pause
exit /b 1

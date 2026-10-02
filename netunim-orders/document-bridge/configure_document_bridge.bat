@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "APPROOT=%LOCALAPPDATA%\NetunimDocumentBridge"
set "ACTIVEFILE=%APPROOT%\active-runtime.txt"
set "NODEPOINTER=%APPROOT%\node-runtime.txt"
set "SUMMARY=%APPROOT%\INSTALLATION-LOG.txt"
set "RUNTIMENAME="
set "NODERUNTIME="

if not exist "%ACTIVEFILE%" goto :not_installed
if not exist "%NODEPOINTER%" goto :not_installed
set /p "RUNTIMENAME="<"%ACTIVEFILE%"
set /p "NODERUNTIME="<"%NODEPOINTER%"
if /I not "%RUNTIMENAME:~0,6%"=="app-v3" goto :not_installed
if not "%RUNTIMENAME:\=%"=="%RUNTIMENAME%" goto :not_installed
if not "%RUNTIMENAME:/=%"=="%RUNTIMENAME%" goto :not_installed
if not "%RUNTIMENAME:..=%"=="%RUNTIMENAME%" goto :not_installed
if /I not "%NODERUNTIME:~0,22%"=="node-v24.21.0-win-x64-" goto :not_installed
if not "%NODERUNTIME:\=%"=="%NODERUNTIME%" goto :not_installed
if not "%NODERUNTIME:/=%"=="%NODERUNTIME%" goto :not_installed
if not "%NODERUNTIME:..=%"=="%NODERUNTIME%" goto :not_installed
set "APPDIR=%APPROOT%\%RUNTIMENAME%"
set "NODE_EXE=%APPROOT%\%NODERUNTIME%\node.exe"
if not exist "%APPDIR%\server.mjs" goto :not_installed
if not exist "%NODE_EXE%" goto :not_installed

echo.
echo Document Bridge searches the COMPLETE Everything index.
echo There is no separate folder list in the Bridge.
echo Add/remove indexed drives and folders directly in Everything Options.
echo.
"%NODE_EXE%" "%APPDIR%\server.mjs" --ensure-everything
if errorlevel 1 goto :diagnostic_error
"%NODE_EXE%" "%APPDIR%\server.mjs" --doctor
if errorlevel 1 goto :diagnostic_error
"%NODE_EXE%" "%APPDIR%\server.mjs" --write-install-summary >nul 2>nul
if errorlevel 1 goto :diagnostic_error
if exist "%SUMMARY%" start "" notepad.exe "%SUMMARY%"
pause
exit /b 0

:diagnostic_error
"%NODE_EXE%" "%APPDIR%\server.mjs" --write-install-summary >nul 2>nul
if exist "%SUMMARY%" start "" notepad.exe "%SUMMARY%"
echo ERROR: Document Bridge diagnostics failed. See INSTALLATION-LOG.txt and bridge-console.log.
pause
exit /b 1

:not_installed
echo ERROR: Document Bridge or its pinned private Node runtime is not installed correctly on this computer.
echo Run install_document_bridge.bat again.
pause
exit /b 1

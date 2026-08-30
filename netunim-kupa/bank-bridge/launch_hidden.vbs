Option Explicit
Dim shell, appDir, command
Set shell = CreateObject("WScript.Shell")
appDir = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\NetunimKupaBankBridge\app"
command = "cmd.exe /d /s /c " & Chr(34) & Chr(34) & appDir & "\start_bank_bridge.bat" & Chr(34) & " --hidden" & Chr(34)
shell.Run command, 0, False

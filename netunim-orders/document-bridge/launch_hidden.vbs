Option Explicit
Dim shell, fso, app, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
app = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\NetunimDocumentBridge\app\start_document_bridge.bat"
If fso.FileExists(app) Then
  cmd = "cmd.exe /d /c """ & app & """"
  shell.Run cmd, 0, False
End If

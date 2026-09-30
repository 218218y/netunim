Option Explicit
Dim shell, fso, root, activeFile, runtimeName, app, cmd, stream
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\NetunimDocumentBridge"
activeFile = root & "\active-runtime.txt"
runtimeName = "app"
On Error Resume Next
If fso.FileExists(activeFile) Then
  Set stream = fso.OpenTextFile(activeFile, 1, False)
  If Err.Number = 0 Then
    runtimeName = Trim(stream.ReadLine)
    stream.Close
  End If
End If
Err.Clear
On Error GoTo 0
If runtimeName = "" Or InStr(runtimeName, "\") > 0 Or InStr(runtimeName, "/") > 0 Or InStr(runtimeName, "..") > 0 Then runtimeName = "app"
app = root & "\" & runtimeName & "\start_document_bridge.bat"
If Not fso.FileExists(app) Then app = root & "\app\start_document_bridge.bat"
If fso.FileExists(app) Then
  cmd = "cmd.exe /d /c """ & app & """"
  shell.Run cmd, 0, False
End If

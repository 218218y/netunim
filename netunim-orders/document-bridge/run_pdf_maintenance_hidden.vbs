Option Explicit
' Windows Script Host does not allocate a visible console window.
' Keep the real maintenance worker synchronous so Task Scheduler receives its exit code.
Dim shell, fso, root, runner, powerShellExe, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\NetunimDocumentBridge"
runner = root & "\run_pdf_maintenance.ps1"
powerShellExe = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
If Not fso.FileExists(runner) Or Not fso.FileExists(powerShellExe) Then
  WScript.Quit 2
End If
command = """" & powerShellExe & """ -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & runner & """"
WScript.Quit shell.Run(command, 0, True)

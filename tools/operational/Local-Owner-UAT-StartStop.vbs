Option Explicit

Dim fso, shell, action, here, repoRoot, psScript, localRoot, errorFile, pwsh, command, exitCode, message, icon
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

If WScript.Arguments.Count <> 1 Then
  ShowMessage "คำสั่งไม่ถูกต้อง กรุณาใช้ Desktop Shortcut ของ NIPT-CBH Local", 48
  WScript.Quit 2
End If

action = UCase(WScript.Arguments(0))
If action <> "START" And action <> "STOP" Then
  ShowMessage "คำสั่งไม่ถูกต้อง กรุณาใช้ Desktop Shortcut ของ NIPT-CBH Local", 48
  WScript.Quit 2
End If

here = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(here))
psScript = fso.BuildPath(here, "Local-Owner-UAT.ps1")
localRoot = fso.BuildPath(repoRoot, ".local\owner-local-uat-1.0.2")
errorFile = fso.BuildPath(localRoot, "launcher-last-error.txt")
pwsh = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\PowerShell\7\pwsh.exe"

If Not fso.FileExists(psScript) Then
  ShowMessage "ไม่พบ Local UAT Launcher ใน Worktree ที่กำหนด", 48
  WScript.Quit 1
End If
If Not fso.FileExists(pwsh) Then
  ShowMessage "ไม่พบ PowerShell 7 ในเครื่องนี้", 48
  WScript.Quit 1
End If

command = Quote(pwsh) & " -NoLogo -NoProfile -NonInteractive -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Quote(psScript) & " -Action " & action
exitCode = shell.Run(command, 0, True)

If exitCode = 0 Then
  If action = "START" Then
    shell.Run "https://127.0.0.1:19548/login", 1, False
    message = "NIPT-CBH Local พร้อมทดลองแล้ว และเปิดหน้า Login ใน Default Browser แล้ว"
  Else
    message = "ปิดบริการ NIPT-CBH Local แล้ว ข้อมูล Database และไฟล์ทดลองยังคงอยู่"
  End If
  icon = 64
Else
  message = ReadLastError(errorFile)
  If Len(message) = 0 Then message = "ดำเนินการไม่สำเร็จ กรุณาเปิด NIPT-CBH Local Status ตรวจสอบรายละเอียด"
  icon = 48
End If

ShowMessage message, icon
WScript.Quit exitCode

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function

Function ReadLastError(path)
  Dim file
  ReadLastError = ""
  If fso.FileExists(path) Then
    Set file = fso.OpenTextFile(path, 1, False, -1)
    ReadLastError = Trim(file.ReadAll)
    file.Close
  End If
End Function

Sub ShowMessage(text, messageIcon)
  If Len(text) > 240 Then text = Left(text, 237) & "..."
  shell.Popup text, 8, "NIPT-CBH Local", messageIcon
End Sub

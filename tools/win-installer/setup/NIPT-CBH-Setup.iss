; NIPT-CBH one-click Windows Setup (Inno Setup 6). TEST RELEASE: synthetic accounts, self-signed certificate, no Production HIS.
; The wizard only extracts the verified offline package to a temporary folder and runs the unchanged P8 engine through setup-run.mjs.
; Build:  ISCC /DPackageDir=<package folder> /DKeyFile=<public key .pem> /DAppVersion=1.0.0 /DOutDir=<folder> NIPT-CBH-Setup.iss
; Command line (all optional): /ROOT=C:\NIPT-CBH /HOST=<ip or dns name> /LAN=yes|no /LANALLOW=<LocalSubnet|CIDR> /ALLOWPUBLIC=1 /TASKMODE=user|system
;                              /NOTRUST=1 /DELETEDATA=1 (uninstall) plus the standard /VERYSILENT /SUPPRESSMSGBOXES /CURRENTUSER /LOG=
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef PackageDir
  #error PackageDir is required
#endif
#ifndef KeyFile
  #error KeyFile is required
#endif
#ifndef OutDir
  #define OutDir "."
#endif

[Setup]
AppId={{B7E4C2A1-5D3F-4E8A-9C61-0A1B2C3D4E5F}
AppName=NIPT-CBH
AppVersion={#AppVersion}
AppVerName=NIPT-CBH {#AppVersion}
AppPublisher=NIPT-CBH โรงพยาบาลชลบุรี (รุ่นทดลอง)
DefaultDirName={autopf}\NIPT-CBH
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableReadyMemo=yes
DisableStartupPrompt=yes
OutputDir={#OutDir}
OutputBaseFilename=NIPT-CBH-Setup-{#AppVersion}
#ifdef CompressionFast
Compression=lzma2/fast
#else
Compression=lzma2/normal
#endif
SolidCompression=yes
LZMAUseSeparateProcess=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
SetupLogging=yes
SetupMutex=NIPT-CBH-Setup-Mutex
UninstallDisplayName=NIPT-CBH {#AppVersion}
CloseApplications=no
RestartApplications=no
ShowLanguageDialog=no
WizardSizePercent=130,125
VersionInfoVersion={#AppVersion}
VersionInfoDescription=NIPT-CBH Setup (test release)
ExtraDiskSpaceRequired=8589934592

[Languages]
Name: "thai"; MessagesFile: "compiler:Languages\Thai.isl"

[Messages]
WelcomeLabel1=NIPT-CBH Setup {#AppVersion}
WelcomeLabel2=ติดตั้งระบบ NIPT-CBH สำหรับโรงพยาบาลชลบุรี%n%nกดปุ่ม "ติดตั้ง" เพียงครั้งเดียว ระบบจะติดตั้งและเริ่มทำงานเอง โดยไม่ต้องใช้อินเทอร์เน็ต ไม่ต้องติดตั้ง Node.js, PostgreSQL หรืออื่นๆ เพิ่ม%n%nรุ่นนี้เป็นรุ่นทดลอง (บัญชีผู้ใช้ทดสอบ ข้อมูลสมมติ) ยังไม่ใช่การใช้งานทางคลินิก
SetupAppTitle=NIPT-CBH Setup
SetupWindowTitle=NIPT-CBH Setup %1
FinishedHeadingLabel=ติดตั้ง NIPT-CBH เสร็จสมบูรณ์

[Files]
; the verified offline package (runtime, application, migrations, installer engine); removed from the temporary folder when Setup ends
Source: "{#PackageDir}\*"; DestDir: "{tmp}\nipt-package"; Flags: recursesubdirs createallsubdirs ignoreversion deleteafterinstall
; the public key for the integrity check lives OUTSIDE the package folder so the package folder matches its signed manifest exactly
Source: "{#KeyFile}"; DestDir: "{tmp}\nipt-key"; DestName: "package-signing-public.pem"; Flags: ignoreversion deleteafterinstall

[Registry]
Root: HKA; Subkey: "SOFTWARE\NIPT-CBH"; ValueType: string; ValueName: "InstallRoot"; ValueData: "{code:GetEngineRoot}"; Flags: uninsdeletekey
Root: HKA; Subkey: "SOFTWARE\NIPT-CBH"; ValueType: string; ValueName: "Version"; ValueData: "{#AppVersion}"; Flags: uninsdeletekey

[Icons]
Name: "{autoprograms}\NIPT-CBH\ตั้งค่าที่อยู่ LAN / ใบรับรอง (Set-LAN)"; Filename: "{code:GetEngineRoot}\Set-LAN.cmd"; WorkingDir: "{code:GetEngineRoot}"
Name: "{autoprograms}\NIPT-CBH\ตรวจสถานะระบบ (Status)"; Filename: "{code:GetEngineRoot}\Status.cmd"; WorkingDir: "{code:GetEngineRoot}"
Name: "{autoprograms}\NIPT-CBH\ถอนการติดตั้ง NIPT-CBH"; Filename: "{uninstallexe}"

[Run]
Filename: "{code:GetUrl}"; Description: "เปิด NIPT-CBH ตอนนี้"; Flags: postinstall shellexec skipifsilent; Check: UrlIsReady
Filename: "{win}\notepad.exe"; Parameters: """{code:GetCredentialsFile}"""; Description: "เปิดไฟล์รหัสผ่านของผู้ใช้ทดสอบ (เปิดได้เฉพาะผู้ติดตั้ง)"; Flags: postinstall nowait skipifsilent unchecked; Check: CredentialsExist

[UninstallDelete]
Type: files; Name: "{autodesktop}\NIPT-CBH.url"
Type: files; Name: "{autoprograms}\NIPT-CBH\เปิด NIPT-CBH.url"
Type: dirifempty; Name: "{autoprograms}\NIPT-CBH"
Type: filesandordirs; Name: "{code:GetEngineRoot}\runtime"

[Code]
var
  CopyButton: TNewButton;
  AdvancedCheck: TNewCheckBox;
  AdvancedPage: TWizardPage;
  RootEdit, HostEdit: TNewEdit;
  PublicCheck, SystemCheck: TNewCheckBox;
  ResultKeys, ResultValues: TStringList;
  FinalUrl, FinalCredentials, FinalMessage, FinalWarnings: String;
  FinalOk, FinalVerified: Boolean;
  DeleteAllData: Boolean;

{ ---------- small helpers ---------- }
function IsAsciiPath(const S: String): Boolean;
var I: Integer;
begin
  Result := Length(S) > 0;
  for I := 1 to Length(S) do
    if (Ord(S[I]) < 32) or (Ord(S[I]) > 126) then begin Result := False; Exit; end;
end;

function CmdParam(const Name, Default: String): String;
begin
  Result := ExpandConstant('{param:' + Name + '|' + Default + '}');
end;

function GetEngineRoot(Unused: String): String;
begin
  Result := '';
  if Assigned(RootEdit) and (RootEdit.Text <> '') then Result := RootEdit.Text
  else if not RegQueryStringValue(HKA, 'SOFTWARE\NIPT-CBH', 'InstallRoot', Result) then Result := CmdParam('ROOT', 'C:\NIPT-CBH');
end;

function ReadFileText(const FileName: String): String;
var Lines: TArrayOfString; I: Integer;
begin
  Result := '';
  if LoadStringsFromFile(FileName, Lines) then
    for I := 0 to GetArrayLength(Lines) - 1 do Result := Result + Lines[I] + #10;
end;

{ Extract the first "key": "value" string from a small JSON text (install-state.json / nipt.json). Not a JSON parser; the files are written by the engine. }
function JsonString(const Text, Key: String): String;
var P, Q: Integer; Needle, Rest: String;
begin
  Result := '';
  Needle := '"' + Key + '": "';
  P := Pos(Needle, Text);
  if P = 0 then Exit;
  Rest := Copy(Text, P + Length(Needle), Length(Text));
  Q := Pos('"', Rest);
  if Q > 0 then Result := Copy(Rest, 1, Q - 1);
end;

function VersionPart(const V: String; Index: Integer): Integer;
var S: String; I, N: Integer;
begin
  S := V; Result := 0;
  for I := 0 to Index do begin
    N := Pos('.', S);
    if I < Index then begin if N = 0 then begin Result := 0; Exit; end; S := Copy(S, N + 1, Length(S)); end
    else begin if N > 0 then S := Copy(S, 1, N - 1); Result := StrToIntDef(S, 0); end;
  end;
end;

function CompareVersion(const A, B: String): Integer;
var I, X, Y: Integer;
begin
  Result := 0;
  for I := 0 to 2 do begin
    X := VersionPart(A, I); Y := VersionPart(B, I);
    if X < Y then begin Result := -1; Exit; end;
    if X > Y then begin Result := 1; Exit; end;
  end;
end;

function UrlIsReady: Boolean; begin Result := FinalOk and (FinalUrl <> ''); end;
function CredentialsExist: Boolean; begin Result := FinalOk and (FinalCredentials <> '') and FileExists(FinalCredentials); end;
function GetUrl(Unused: String): String; begin Result := FinalUrl; end;
function GetCredentialsFile(Unused: String): String; begin Result := FinalCredentials; end;

function ResultValue(const Key: String): String;
var I: Integer;
begin
  Result := '';
  for I := 0 to ResultKeys.Count - 1 do if ResultKeys[I] = Key then begin Result := ResultValues[I]; Exit; end;
end;

procedure LoadResult(const FileName: String);
var Lines: TArrayOfString; I, P: Integer;
begin
  ResultKeys.Clear; ResultValues.Clear;
  if LoadStringsFromFile(FileName, Lines) then
    for I := 0 to GetArrayLength(Lines) - 1 do begin
      P := Pos('=', Lines[I]);
      if P > 1 then begin ResultKeys.Add(Copy(Lines[I], 1, P - 1)); ResultValues.Add(Copy(Lines[I], P + 1, Length(Lines[I]))); end;
    end;
end;

procedure CopyToClipboard(const Text: String);
var Code: Integer;
begin
  Exec(ExpandConstant('{cmd}'), '/C echo|set /p="' + Text + '"|clip', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

procedure CopyUrlClick(Sender: TObject);
begin
  if FinalUrl <> '' then begin CopyToClipboard(FinalUrl); MsgBox('คัดลอก URL แล้ว: ' + FinalUrl, mbInformation, MB_OK); end;
end;

{ ---------- already installed / older / newer ---------- }
function InitializeSetup: Boolean;
var Root, State, Installed, Origin, NodeExe, Cli: String; Code: Integer;
begin
  Result := True;
  if not RegQueryStringValue(HKA, 'SOFTWARE\NIPT-CBH', 'InstallRoot', Root) then Exit;
  State := ReadFileText(Root + '\install-state.json');
  if State = '' then Exit;
  if Pos('UNINSTALLED_DATA_RETAINED', State) > 0 then Exit;       { data kept by an earlier uninstall: Setup reuses it }
  Installed := JsonString(Copy(State, Pos('"current"', State), 400), 'version');
  if Installed = '' then Exit;
  if CompareVersion(Installed, '{#AppVersion}') > 0 then begin
    MsgBox('เครื่องนี้ติดตั้ง NIPT-CBH เวอร์ชัน ' + Installed + ' ซึ่งใหม่กว่าตัวติดตั้งนี้ ระบบจะไม่ติดตั้งเวอร์ชันเก่าทับ', mbError, MB_OK);
    Result := False; Exit;
  end;
  if CompareVersion(Installed, '{#AppVersion}') = 0 then begin
    { opening the Setup again never recreates anything: make sure the services are running and show the real address }
    NodeExe := Root + '\runtime\node\node.exe'; Cli := Root + '\admin\nipt-admin.mjs';
    if FileExists(NodeExe) and FileExists(Cli) then
      Exec(NodeExe, '"' + Cli + '" start --root "' + Root + '"', Root, SW_HIDE, ewWaitUntilTerminated, Code);
    Origin := JsonString(ReadFileText(Root + '\config\nipt.json'), 'origin');
    MsgBox('มีการติดตั้ง NIPT-CBH เวอร์ชัน ' + Installed + ' อยู่แล้ว ไม่มีการเปลี่ยนแปลงข้อมูลใดๆ' + #13#10 + #13#10 + 'ที่อยู่เปิดระบบ: ' + Origin + #13#10 + 'ใช้ไอคอน NIPT-CBH บนเดสก์ท็อปเพื่อเปิดระบบ', mbInformation, MB_OK);
    Result := False;
  end;
  { older version installed: continue, the engine upgrades in place and keeps the data }
end;

{ ---------- wizard ---------- }
procedure InitializeWizard;
var Lbl: TNewStaticText;
begin
  ResultKeys := TStringList.Create; ResultValues := TStringList.Create;
  WizardForm.NextButton.Caption := 'ติดตั้ง';
  AdvancedCheck := TNewCheckBox.Create(WizardForm);
  AdvancedCheck.Parent := WizardForm.WelcomePage;
  AdvancedCheck.Left := WizardForm.WelcomeLabel2.Left;
  AdvancedCheck.Top := WizardForm.WelcomeLabel2.Top + WizardForm.WelcomeLabel2.Height + ScaleY(12);
  AdvancedCheck.Width := WizardForm.WelcomeLabel2.Width;
  AdvancedCheck.Caption := 'ตัวเลือกขั้นสูง (เปลี่ยนตำแหน่งติดตั้ง / ที่อยู่ LAN) — ไม่จำเป็นสำหรับการติดตั้งทั่วไป';
  AdvancedPage := CreateCustomPage(wpWelcome, 'ตัวเลือกขั้นสูง', 'ใช้ค่าเริ่มต้นได้เลยถ้าไม่แน่ใจ');
  Lbl := TNewStaticText.Create(AdvancedPage); Lbl.Parent := AdvancedPage.Surface; Lbl.Left := 0; Lbl.Top := 0;
  Lbl.Caption := 'โฟลเดอร์ติดตั้งข้อมูลและโปรแกรม (ต้องเป็นตัวอักษรอังกฤษ/ตัวเลขเท่านั้น):';
  RootEdit := TNewEdit.Create(AdvancedPage); RootEdit.Parent := AdvancedPage.Surface; RootEdit.Left := 0; RootEdit.Top := Lbl.Top + ScaleY(20); RootEdit.Width := AdvancedPage.SurfaceWidth;
  RootEdit.Text := CmdParam('ROOT', 'C:\NIPT-CBH');
  Lbl := TNewStaticText.Create(AdvancedPage); Lbl.Parent := AdvancedPage.Surface; Lbl.Left := 0; Lbl.Top := RootEdit.Top + ScaleY(40);
  Lbl.Caption := 'ชื่อ DNS ภายในโรงพยาบาลที่ใช้เปิดระบบ (เว้นว่าง = ใช้ IP ของเครื่องนี้โดยอัตโนมัติ):';
  HostEdit := TNewEdit.Create(AdvancedPage); HostEdit.Parent := AdvancedPage.Surface; HostEdit.Left := 0; HostEdit.Top := Lbl.Top + ScaleY(20); HostEdit.Width := AdvancedPage.SurfaceWidth;
  HostEdit.Text := CmdParam('HOST', '');
  PublicCheck := TNewCheckBox.Create(AdvancedPage); PublicCheck.Parent := AdvancedPage.Surface; PublicCheck.Left := 0; PublicCheck.Top := HostEdit.Top + ScaleY(40); PublicCheck.Width := AdvancedPage.SurfaceWidth;
  PublicCheck.Caption := 'อนุญาตให้เข้าได้แม้เครือข่ายถูกตั้งเป็นประเภท Public (ยังจำกัดเฉพาะวงเดียวกัน)';
  PublicCheck.Checked := CmdParam('ALLOWPUBLIC', '') = '1';
  SystemCheck := TNewCheckBox.Create(AdvancedPage); SystemCheck.Parent := AdvancedPage.Surface; SystemCheck.Left := 0; SystemCheck.Top := PublicCheck.Top + ScaleY(28); SystemCheck.Width := AdvancedPage.SurfaceWidth;
  SystemCheck.Caption := 'เริ่มระบบตอนเปิดเครื่อง (SYSTEM) — ยังไม่ผ่านการทดสอบจริง ไม่แนะนำ';
  SystemCheck.Checked := CmdParam('TASKMODE', 'user') = 'system';
  CopyButton := TNewButton.Create(WizardForm);
  CopyButton.Parent := WizardForm;
  CopyButton.Left := ScaleX(20);
  CopyButton.Top := WizardForm.NextButton.Top;
  CopyButton.Width := ScaleX(120);
  CopyButton.Height := WizardForm.NextButton.Height;
  CopyButton.Caption := 'คัดลอก URL';
  CopyButton.OnClick := @CopyUrlClick;
  CopyButton.Visible := False;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpWelcome then WizardForm.NextButton.Caption := 'ติดตั้ง';
  if CurPageID = AdvancedPage.ID then WizardForm.NextButton.Caption := 'ติดตั้ง';
  CopyButton.Visible := (CurPageID = wpFinished) and FinalOk and (FinalUrl <> '');
  if CurPageID = wpFinished then begin
    if FinalOk then begin
      WizardForm.FinishedHeadingLabel.Caption := 'ติดตั้ง NIPT-CBH สำเร็จ';
      WizardForm.FinishedLabel.Caption := FinalMessage;
    end;
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (AdvancedPage <> nil) and (PageID = AdvancedPage.ID) then Result := not AdvancedCheck.Checked;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (AdvancedPage <> nil) and (CurPageID = AdvancedPage.ID) then begin
    if not IsAsciiPath(RootEdit.Text) then begin
      MsgBox('ชื่อโฟลเดอร์ติดตั้งต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือช่องว่างเท่านั้น (PostgreSQL ใช้ชื่อโฟลเดอร์ภาษาไทยไม่ได้)', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ ---------- the installation itself ---------- }
procedure RunEngine;
var
  Pkg, Node, Root, Tmp, ResultFile, ProgFile, LogDir, Params, Line, Prog: String;
  Code, Percent, P: Integer; Waited: Integer; Started: Boolean;
begin
  Pkg := ExpandConstant('{tmp}\nipt-package');
  Node := Pkg + '\payload\runtime\node\node.exe';
  Root := GetEngineRoot('');
  Tmp := ExpandConstant('{tmp}');
  ResultFile := Tmp + '\nipt-setup-result.txt';
  ProgFile := Tmp + '\nipt-setup-progress.txt';
  LogDir := ExpandConstant('{commonappdata}\NIPT-CBH\setup-logs');
  DeleteFile(ResultFile); DeleteFile(ProgFile);
  Params := '"' + Pkg + '\installer\setup-run.mjs" --package "' + Pkg + '" --public-key "' + Tmp + '\nipt-key\package-signing-public.pem" --root "' + Root + '"' +
    ' --result "' + ResultFile + '" --progress "' + ProgFile + '" --log-dir "' + LogDir + '"' +
    ' --lan ' + CmdParam('LAN', 'yes') + ' --lan-allow "' + CmdParam('LANALLOW', 'LocalSubnet') + '"';
  if (Assigned(HostEdit) and (HostEdit.Text <> '')) then Params := Params + ' --host "' + HostEdit.Text + '"'
  else if CmdParam('HOST', '') <> '' then Params := Params + ' --host "' + CmdParam('HOST', '') + '"';
  if (Assigned(PublicCheck) and PublicCheck.Checked) or (CmdParam('ALLOWPUBLIC', '') = '1') then Params := Params + ' --allow-public yes';
  if (Assigned(SystemCheck) and SystemCheck.Checked) or (CmdParam('TASKMODE', 'user') = 'system') then Params := Params + ' --task-mode system'
  else Params := Params + ' --task-mode user';
  if CmdParam('NOTRUST', '') = '1' then Params := Params + ' --trust no';
  WizardForm.StatusLabel.Caption := 'กำลังติดตั้ง NIPT-CBH ...';
  WizardForm.FilenameLabel.Caption := '';
  WizardForm.ProgressGauge.Min := 0; WizardForm.ProgressGauge.Max := 100; WizardForm.ProgressGauge.Position := 1;
  Started := Exec(Node, Params, Pkg, SW_HIDE, ewNoWait, Code);
  if not Started then begin FinalOk := False; FinalMessage := 'เริ่มโปรแกรมติดตั้งไม่สำเร็จ (' + SysErrorMessage(Code) + ')'; Exit; end;
  { wait for the engine; each one-second Exec lets Setup process its window messages so the progress page keeps updating }
  Waited := 0;
  while (not FileExists(ResultFile)) and (Waited < 3 * 60 * 60) do begin
    Exec(ExpandConstant('{cmd}'), '/C ping -n 2 127.0.0.1 >nul', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Waited := Waited + 1;
    Prog := ReadFileText(ProgFile);
    P := Pos('|', Prog);
    if P > 0 then begin
      Percent := StrToIntDef(Copy(Prog, 1, P - 1), 0);
      Line := Trim(Copy(Prog, P + 1, Length(Prog)));
      WizardForm.StatusLabel.Caption := Line;
      WizardForm.ProgressGauge.Position := Percent;
    end;
  end;
  Sleep(300);
  LoadResult(ResultFile);
  FinalOk := ResultValue('ok') = 'yes';
  FinalUrl := ResultValue('url');
  FinalVerified := ResultValue('urlVerified') = 'yes';
  FinalCredentials := ResultValue('credentials');
  FinalWarnings := ResultValue('warnings');
  if not FinalOk then begin
    FinalMessage := ResultValue('message');
    if FinalMessage = '' then FinalMessage := 'การติดตั้งไม่สำเร็จ';
    FinalMessage := FinalMessage + #13#10 + #13#10 + 'รายละเอียดทางเทคนิค: ' + ResultValue('log');
    Exit;
  end;
  { the Finish page states only what was actually verified }
  if (FinalUrl <> '') and (ResultValue('lanEnabled') = 'yes') then begin
    if FinalVerified then
      FinalMessage := 'ที่อยู่สำหรับทุกเครื่องในเครือข่ายโรงพยาบาล (ตรวจแล้วจากเครื่องนี้):' + #13#10 + FinalUrl + #13#10 + 'เครื่อง ANC และ Lab เปิดที่อยู่นี้ใน Browser ได้เลย (ต้องอยู่ในเครือข่ายเดียวกัน)'
    else
      FinalMessage := 'ที่อยู่ที่ตั้งไว้: ' + FinalUrl + #13#10 + 'ยังตรวจไม่ผ่านจากเครื่องนี้ — ยังไม่ใช่ที่อยู่ที่ยืนยันว่าใช้งานได้';
  end else
    FinalMessage := 'ที่อยู่เปิดระบบบนเครื่องนี้: ' + FinalUrl + #13#10 + 'ยังไม่ได้เปิดให้เครื่องอื่นเข้า (โหมด LAN ปิด)';
  FinalMessage := FinalMessage + #13#10 + #13#10 + 'ไฟล์ใบรับรองสำหรับติดตั้งบนเครื่องอื่น (ถ้า Browser เตือน): ' + ResultValue('certificateDownload');
  if FinalWarnings <> '' then FinalMessage := FinalMessage + #13#10 + #13#10 + 'สิ่งที่ต้องทราบ / ตั้งค่าเพิ่ม:' + #13#10 + '- ' + FinalWarnings;
end;

procedure MakeShortcuts;
var Body: String; Dir: String;
begin
  if not UrlIsReady then Exit;
  Body := '[InternetShortcut]' + #13#10 + 'URL=' + FinalUrl + #13#10;
  SaveStringToFile(ExpandConstant('{autodesktop}\NIPT-CBH.url'), Body, False);
  Dir := ExpandConstant('{autoprograms}\NIPT-CBH');
  ForceDirectories(Dir);
  SaveStringToFile(Dir + '\เปิด NIPT-CBH.url', Body, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    RunEngine;
    if FinalOk then MakeShortcuts
    else begin
      Log('NIPT-CBH engine failed: ' + FinalMessage);
      MsgBox(FinalMessage, mbError, MB_OK);
      Abort;
    end;
  end;
end;

{ ---------- uninstall: data is kept unless the administrator explicitly agrees twice ---------- }
function InitializeUninstall: Boolean;
begin
  Result := True;
  DeleteAllData := CmdParam('DELETEDATA', '') = '1';
  if (not DeleteAllData) and (not UninstallSilent) then begin
    if MsgBox('ต้องการลบ "ข้อมูลทั้งหมด" ของ NIPT-CBH ด้วยหรือไม่ (ฐานข้อมูล ไฟล์ผู้ป่วย รูปภาพ ข้อมูลสำรอง)?' + #13#10 + #13#10 + 'กด "ไม่ใช่" เพื่อถอนเฉพาะโปรแกรมและเก็บข้อมูลไว้ (แนะนำ)', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      if MsgBox('ยืนยันอีกครั้ง: การลบข้อมูลทั้งหมดไม่สามารถกู้คืนได้ ยืนยันลบถาวรหรือไม่?', mbError, MB_YESNO or MB_DEFBUTTON2) = IDYES then DeleteAllData := True;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Root, Node, Cli, Params, Base: String; Code, I: Integer;
begin
  if CurUninstallStep = usUninstall then begin
    Root := GetEngineRoot('');
    Node := Root + '\runtime\node\node.exe'; Cli := Root + '\admin\nipt-admin.mjs';
    Base := Root; I := Length(Base);
    while (I > 0) and (Base[I] = '\') do begin Base := Copy(Base, 1, I - 1); I := Length(Base); end;
    while Pos('\', Base) > 0 do Base := Copy(Base, Pos('\', Base) + 1, Length(Base));
    Params := '"' + Cli + '" uninstall --root "' + Root + '" --confirm "' + Base + '"';
    if DeleteAllData then Params := Params + ' --remove-data';
    if FileExists(Node) and FileExists(Cli) then Exec(Node, Params, Root, SW_HIDE, ewWaitUntilTerminated, Code);
    if DeleteAllData then Sleep(6000);   { the engine removes its own folder after it exits }
  end;
end;

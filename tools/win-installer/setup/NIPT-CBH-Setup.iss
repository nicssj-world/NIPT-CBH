; NIPT-CBH one-click Windows Setup (Inno Setup 6). /DProduction=1 = PRODUCTION profile (the person installing names the first administrator and clinical approver; random one-time passwords; no test accounts); without it = TEST RELEASE (synthetic accounts). Self-signed certificate, no HIS connection either way.
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
#ifdef Production
  #define Publisher "NIPT-CBH โรงพยาบาลชลบุรี"
  #define VersionDescription "NIPT-CBH Setup (production profile)"
  #define WelcomeNote "ตัวติดตั้งจะสร้างบัญชีผู้ดูแลระบบและผู้อนุมัติทางคลินิกตามชื่อที่ท่านระบุ พร้อมรหัสผ่านครั้งเดียวที่ต้องเปลี่ยนเมื่อเข้าสู่ระบบครั้งแรก การใช้งานทางคลินิกต้องผ่านการรับรองของโรงพยาบาลก่อน"
  #define CredentialsDescription "เปิดไฟล์รหัสผ่านครั้งเดียวของผู้ดูแลระบบ (เปิดได้เฉพาะผู้ติดตั้ง ลบไฟล์หลังส่งมอบ)"
#else
  #define Publisher "NIPT-CBH โรงพยาบาลชลบุรี (รุ่นทดลอง)"
  #define VersionDescription "NIPT-CBH Setup (test release)"
  #define WelcomeNote "รุ่นนี้เป็นรุ่นทดลอง (บัญชีผู้ใช้ทดสอบ ข้อมูลสมมติ) ยังไม่ใช่การใช้งานทางคลินิก"
  #define CredentialsDescription "เปิดไฟล์รหัสผ่านของผู้ใช้ทดสอบ (เปิดได้เฉพาะผู้ติดตั้ง)"
#endif

[Setup]
AppId={code:GetSetupAppId}
AppName=NIPT-CBH
AppVersion={#AppVersion}
AppVerName=NIPT-CBH {#AppVersion}
AppPublisher={#Publisher}
DefaultDirName={autopf}\NIPT-CBH
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableWelcomePage=no
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
Uninstallable=not IsParityRehearsal
SetupMutex=NIPT-CBH-Setup-Mutex
UninstallDisplayName=NIPT-CBH {#AppVersion}
CloseApplications=no
RestartApplications=no
ShowLanguageDialog=no
UsePreviousLanguage=no
WizardSizePercent=130,150
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#VersionDescription}
ExtraDiskSpaceRequired=8589934592

[Languages]
Name: "thai"; MessagesFile: "compiler:Languages\Thai.isl"

[Messages]
WelcomeLabel1=NIPT-CBH Setup {#AppVersion}
WelcomeLabel2=ติดตั้งระบบ NIPT-CBH สำหรับโรงพยาบาลชลบุรี%n%nกดปุ่ม "ติดตั้ง" เพียงครั้งเดียว ระบบจะติดตั้งและเริ่มทำงานเอง โดยไม่ต้องใช้อินเทอร์เน็ต ไม่ต้องติดตั้ง Node.js, PostgreSQL หรืออื่นๆ เพิ่ม%n%n{#WelcomeNote}
ClickNext=กด "ติดตั้ง" เพื่อเริ่ม หรือกด "ยกเลิก" เพื่อออกจากตัวติดตั้ง
SetupAppTitle=NIPT-CBH Setup
SetupWindowTitle=NIPT-CBH Setup %1
FinishedHeadingLabel=ติดตั้ง NIPT-CBH เสร็จสมบูรณ์

[Files]
; the verified offline package (runtime, application, migrations, installer engine); removed from the temporary folder when Setup ends
Source: "{#PackageDir}\*"; DestDir: "{tmp}\nipt-package"; Flags: recursesubdirs createallsubdirs ignoreversion deleteafterinstall
; the public key for the integrity check lives OUTSIDE the package folder so the package folder matches its signed manifest exactly
Source: "{#KeyFile}"; DestDir: "{tmp}\nipt-key"; DestName: "package-signing-public.pem"; Flags: ignoreversion deleteafterinstall

[Registry]
Root: HKA; Subkey: "SOFTWARE\NIPT-CBH"; ValueType: string; ValueName: "InstallRoot"; ValueData: "{code:GetEngineRoot}"; Flags: uninsdeletekey; Check: not IsParityRehearsal
Root: HKA; Subkey: "SOFTWARE\NIPT-CBH"; ValueType: string; ValueName: "Version"; ValueData: "{#AppVersion}"; Flags: uninsdeletekey; Check: not IsParityRehearsal

[Icons]
Name: "{autoprograms}\NIPT-CBH\ตั้งค่าที่อยู่ LAN และใบรับรอง (Set-LAN)"; Filename: "{code:GetEngineRoot}\Set-LAN.cmd"; WorkingDir: "{code:GetEngineRoot}"; Check: not IsParityRehearsal
Name: "{autoprograms}\NIPT-CBH\ตรวจสถานะระบบ (Status)"; Filename: "{code:GetEngineRoot}\Status.cmd"; WorkingDir: "{code:GetEngineRoot}"; Check: not IsParityRehearsal
Name: "{autoprograms}\NIPT-CBH\ถอนการติดตั้ง NIPT-CBH"; Filename: "{uninstallexe}"; Check: not IsParityRehearsal

[Run]
Filename: "{code:GetUrl}"; Description: "เปิด NIPT-CBH ตอนนี้"; Flags: postinstall shellexec skipifsilent; Check: UrlIsReady
Filename: "{win}\notepad.exe"; Parameters: """{code:GetCredentialsFile}"""; Description: "{#CredentialsDescription}"; Flags: postinstall nowait skipifsilent unchecked; Check: CredentialsExist

[UninstallDelete]
Type: files; Name: "{autodesktop}\NIPT-CBH.url"
Type: files; Name: "{autoprograms}\NIPT-CBH\เปิด NIPT-CBH.url"
Type: dirifempty; Name: "{autoprograms}\NIPT-CBH"
Type: filesandordirs; Name: "{code:GetEngineRoot}\runtime"

[Code]
{ Thai sentences for steps, warnings, errors and failed checks (generated from setup-messages.mjs by build-setup.ts) }
#include MessagesInc

var
  CopyButton: TNewButton;
  AdvancedCheck: TNewCheckBox;
  AdvancedPage: TWizardPage;
  RootEdit, HostEdit: TNewEdit;
  AdminPage: TInputQueryWizardPage;
  AdminNeeded: Boolean;
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

function IsProductionBuild: Boolean;
begin
#ifdef Production
  Result := True;
#else
  Result := False;
#endif
end;

{ Production: usernames are lowercase ASCII (3-64), never uat.* / synthetic.*; names must not contain quotes (they travel as command-line arguments). }
function IsValidUsername(const S: String): Boolean;
var I: Integer;
begin
  Result := (Length(S) >= 3) and (Length(S) <= 64);
  for I := 1 to Length(S) do
    if not (((S[I] >= 'a') and (S[I] <= 'z')) or ((S[I] >= '0') and (S[I] <= '9')) or (S[I] = '.') or (S[I] = '_') or (S[I] = '-')) then Result := False;
  if (Copy(S, 1, 4) = 'uat.') or (Copy(S, 1, 10) = 'synthetic.') then Result := False;
end;

function IsValidFullName(const S: String): Boolean;
var I: Integer;
begin
  Result := (Length(Trim(S)) >= 1) and (Length(S) <= 120);
  for I := 1 to Length(S) do
    if (S[I] = '"') or (Ord(S[I]) < 32) then Result := False;
end;

{ value typed on the first-account page, or the silent-install command-line parameter }
function AdminValue(Index: Integer; const ParamName: String): String;
begin
  Result := CmdParam(ParamName, '');
  if (Result = '') and Assigned(AdminPage) then Result := Trim(AdminPage.Values[Index]);
end;

{ Opt-in test wrapper isolation. Never reads/writes the normal product registration or shortcuts. }
function IsParityRehearsal: Boolean;
begin
  Result := CmdParam('PARITYREHEARSAL', '') <> '';
end;

function GetSetupAppId(Unused: String): String;
begin
  if IsParityRehearsal then Result := 'NIPT-CBH-Parity-' + CmdParam('PARITYREHEARSAL', '')
  else Result := '{B7E4C2A1-5D3F-4E8A-9C61-0A1B2C3D4E5F}';
end;

function ValidParityArguments: Boolean;
var Tag, Root: String; I: Integer;
begin
  Tag := CmdParam('PARITYREHEARSAL', ''); Root := CmdParam('ROOT', '');
  Result := (Length(Tag) >= 6) and (Length(Tag) <= 60);
  for I := 1 to Length(Tag) do
    if not (((Tag[I] >= 'a') and (Tag[I] <= 'z')) or ((Tag[I] >= '0') and (Tag[I] <= '9')) or (Tag[I] = '-')) then Result := False;
  Result := Result and not IsAdminInstallMode and WizardSilent and IsAsciiPath(Root) and
    (Length(ExtractFileDrive(Root)) = 2) and (CompareText(ExpandFileName(Root), Root) = 0) and
    (Pos('\.local\p8-win\parity-upgrade-' + Tag, Lowercase(Root)) > 0) and
    (ExtractFileName(Root) = 'parity-upgrade-' + Tag) and
    (CompareText(CmdParam('DIR', ''), Root + '\setup-wrapper') = 0) and
    (CmdParam('LAN', '') = 'no') and (CmdParam('NOTRUST', '') = '1') and (CmdParam('TASKMODE', '') = 'user');
end;

function GetEngineRoot(Unused: String): String;
begin
  if IsParityRehearsal then begin Result := CmdParam('ROOT', ''); Exit; end;
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
  if FinalUrl <> '' then begin CopyToClipboard(FinalUrl); SuppressibleMsgBox('คัดลอก URL แล้ว: ' + FinalUrl, mbInformation, MB_OK, IDOK); end;
end;

{ ---------- already installed / older / newer ---------- }
procedure ExitProcess(ExitCode: Integer);
external 'ExitProcess@kernel32.dll stdcall';

function InitializeSetup: Boolean;
var Root, State, Installed, Origin, NodeExe, Cli: String; Code: Integer;
begin
  Result := True;
  if IsParityRehearsal then begin
    Result := ValidParityArguments;
    if not Result then Log('PARITY_REHEARSAL_ARGUMENTS_INVALID');
    Exit;
  end;
  if not RegQueryStringValue(HKA, 'SOFTWARE\NIPT-CBH', 'InstallRoot', Root) then Exit;
  State := ReadFileText(Root + '\install-state.json');
  if State = '' then Exit;
  if Pos('UNINSTALLED_DATA_RETAINED', State) > 0 then Exit;       { data kept by an earlier uninstall: Setup reuses it }
  Installed := JsonString(Copy(State, Pos('"current"', State), 400), 'version');
  if Installed = '' then Exit;
  if CompareVersion(Installed, '{#AppVersion}') > 0 then begin
    SuppressibleMsgBox('เครื่องนี้ติดตั้ง NIPT-CBH เวอร์ชัน ' + Installed + ' ซึ่งใหม่กว่าตัวติดตั้งนี้ ระบบจะไม่ติดตั้งเวอร์ชันเก่าทับ', mbError, MB_OK, IDOK);
    Result := False; Exit;
  end;
  if CompareVersion(Installed, '{#AppVersion}') = 0 then begin
    { opening the Setup again never recreates anything: make sure the services are running and show the real address }
    NodeExe := Root + '\runtime\node\node.exe'; Cli := Root + '\admin\nipt-admin.mjs';
    if FileExists(NodeExe) and FileExists(Cli) then
      Exec(NodeExe, '"' + Cli + '" start --root "' + Root + '"', Root, SW_HIDE, ewWaitUntilTerminated, Code);
    Origin := JsonString(ReadFileText(Root + '\config\nipt.json'), 'origin');
    SuppressibleMsgBox('มีการติดตั้ง NIPT-CBH เวอร์ชัน ' + Installed + ' อยู่แล้ว ไม่มีการเปลี่ยนแปลงข้อมูลใดๆ' + #13#10 + #13#10 + 'ที่อยู่เปิดระบบ: ' + Origin + #13#10 + 'ใช้ไอคอน NIPT-CBH บนเดสก์ท็อปเพื่อเปิดระบบ', mbInformation, MB_OK, IDOK);
    Result := False;
    DelTree(ExpandConstant('{tmp}'), True, True, True);
    ExitProcess(0);                                                   { already installed is a success, not a failure }
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
  AdminNeeded := True;
  if IsProductionBuild then begin
    AdminPage := CreateInputQueryPage(AdvancedPage.ID, 'บัญชีเริ่มต้นของระบบ', 'ระบุผู้ดูแลระบบและผู้อนุมัติทางคลินิก (คนละคน) ระบบจะสร้างรหัสผ่านครั้งเดียวให้ ไม่มีบัญชีหรือรหัสผ่านที่กำหนดไว้ล่วงหน้า',
      'ชื่อผู้ใช้ใช้ตัวพิมพ์เล็กภาษาอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง (3-64 ตัวอักษร)');
    AdminPage.Add('ชื่อผู้ใช้ของผู้ดูแลระบบ (APP_ADMIN):', False);
    AdminPage.Add('ชื่อ-นามสกุลผู้ดูแลระบบ:', False);
    AdminPage.Add('ชื่อผู้ใช้ของผู้อนุมัติทางคลินิก (CLINICAL_APPROVER):', False);
    AdminPage.Add('ชื่อ-นามสกุลผู้อนุมัติทางคลินิก:', False);
    AdminPage.Values[0] := CmdParam('ADMINUSER', '');
    AdminPage.Values[1] := CmdParam('ADMINNAME', '');
    AdminPage.Values[2] := CmdParam('CHECKERUSER', '');
    AdminPage.Values[3] := CmdParam('CHECKERNAME', '');
  end;
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
      WizardForm.FinishedLabel.AdjustHeight;          { long text (URL, certificate link, warnings) must not sit under the check boxes }
      WizardForm.RunList.Top := WizardForm.FinishedLabel.Top + WizardForm.FinishedLabel.Height + ScaleY(10);
    end;
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (AdvancedPage <> nil) and (PageID = AdvancedPage.ID) then Result := not AdvancedCheck.Checked;
  if (AdminPage <> nil) and (PageID = AdminPage.ID) then Result := not AdminNeeded;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var AU, CU: String;
begin
  Result := True;
  if (AdminPage <> nil) and (CurPageID = AdminPage.ID) then begin
    AU := Trim(AdminPage.Values[0]); CU := Trim(AdminPage.Values[2]);
    if not IsValidUsername(AU) or not IsValidUsername(CU) then begin
      SuppressibleMsgBox('ชื่อผู้ใช้ไม่ถูกต้อง: ใช้ตัวพิมพ์เล็กภาษาอังกฤษ ตัวเลข จุด ขีดกลาง ขีดล่าง ความยาว 3-64 ตัวอักษร และห้ามขึ้นต้นด้วย uat. หรือ synthetic.', mbError, MB_OK, IDOK);
      Result := False; Exit;
    end;
    if AU = CU then begin
      SuppressibleMsgBox('ผู้ดูแลระบบและผู้อนุมัติทางคลินิกต้องเป็นคนละคน (ชื่อผู้ใช้ต้องไม่ซ้ำกัน)', mbError, MB_OK, IDOK);
      Result := False; Exit;
    end;
    if not IsValidFullName(AdminPage.Values[1]) or not IsValidFullName(AdminPage.Values[3]) then begin
      SuppressibleMsgBox('กรุณากรอกชื่อ-นามสกุลทั้งสองคน (ห้ามมีเครื่องหมายอัญประกาศ)', mbError, MB_OK, IDOK);
      Result := False; Exit;
    end;
  end;
  if (AdvancedPage <> nil) and (CurPageID = AdvancedPage.ID) then begin
    if not IsAsciiPath(RootEdit.Text) then begin
      SuppressibleMsgBox('ชื่อโฟลเดอร์ติดตั้งต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือช่องว่างเท่านั้น (PostgreSQL ใช้ชื่อโฟลเดอร์ภาษาไทยไม่ได้)', mbError, MB_OK, IDOK);
      Result := False;
    end;
  end;
end;

{ comma-separated ASCII codes written by Setup -> bullet list of the Thai sentences compiled into this wizard }
function WarningLines(const Codes: String): String;
var Rest, Code, T: String; P: Integer;
begin
  Result := ''; Rest := Codes;
  while Rest <> '' do begin
    P := Pos(',', Rest);
    if P = 0 then begin Code := Rest; Rest := ''; end
    else begin Code := Copy(Rest, 1, P - 1); Rest := Copy(Rest, P + 1, Length(Rest)); end;
    T := WarningText(Code);
    if T <> '' then Result := Result + #13#10 + '- ' + T;
  end;
end;

function CheckLines(const Codes: String): String;
var Rest, Item, Id, Detail: String; P, Q: Integer;
begin
  Result := ''; Rest := Codes;
  while Rest <> '' do begin
    P := Pos(',', Rest);
    if P = 0 then begin Item := Rest; Rest := ''; end
    else begin Item := Copy(Rest, 1, P - 1); Rest := Copy(Rest, P + 1, Length(Rest)); end;
    Q := Pos('~', Item);
    if Q = 0 then begin Id := Item; Detail := ''; end
    else begin Id := Copy(Item, 1, Q - 1); Detail := Copy(Item, Q + 1, Length(Item)); end;
    if (Id <> 'excel_installed') and (Id <> 'default_printer_current_user') and (Id <> '') then
      Result := Result + #13#10 + '- ' + CheckText(Id, Detail);
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
  if IsParityRehearsal then LogDir := Root + '\parity-evidence\setup-logs';
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
  if CmdParam('INSTANCE', '') <> '' then Params := Params + ' --instance "' + CmdParam('INSTANCE', '') + '"';
  if IsProductionBuild and AdminNeeded then begin
    { silent installs pass /ADMINUSER= /ADMINNAME= /CHECKERUSER= /CHECKERNAME=; setup-run refuses a production install without all four }
    if AdminValue(0, 'ADMINUSER') <> '' then Params := Params + ' --admin-user "' + AdminValue(0, 'ADMINUSER') + '"';
    if AdminValue(1, 'ADMINNAME') <> '' then Params := Params + ' --admin-name "' + AdminValue(1, 'ADMINNAME') + '"';
    if AdminValue(2, 'CHECKERUSER') <> '' then Params := Params + ' --checker-user "' + AdminValue(2, 'CHECKERUSER') + '"';
    if AdminValue(3, 'CHECKERNAME') <> '' then Params := Params + ' --checker-name "' + AdminValue(3, 'CHECKERNAME') + '"';
  end;
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
      { the file carries only "percent|step number"; the Thai sentence comes from the table compiled into Setup }
      Line := StepText(StrToIntDef(Trim(Copy(Prog, P + 1, Length(Prog))), -1));
      if Line <> '' then WizardForm.StatusLabel.Caption := Line;
      WizardForm.ProgressGauge.Position := Percent;
    end;
  end;
  Sleep(300);
  LoadResult(ResultFile);
  FinalOk := ResultValue('ok') = 'yes';
  FinalUrl := ResultValue('url');
  FinalVerified := ResultValue('urlVerified') = 'yes';
  FinalCredentials := ResultValue('credentials');
  FinalWarnings := WarningLines(ResultValue('warningCodes'));
  if not FinalOk then begin
    FinalMessage := ErrorText(ResultValue('messageCode'));
    if FinalMessage = '' then FinalMessage := ErrorText('GENERIC');
    if ResultValue('messageCode') = 'PREFLIGHT_FAILED' then FinalMessage := FinalMessage + CheckLines(ResultValue('checkCodes'));
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
  if IsProductionBuild and (FinalCredentials <> '') and FileExists(FinalCredentials) then
    FinalMessage := FinalMessage + #13#10 + #13#10 + 'บัญชีผู้ดูแลระบบและผู้อนุมัติทางคลินิกถูกสร้างแล้ว รหัสผ่านครั้งเดียวอยู่ในไฟล์ (เปิดได้เฉพาะผู้ติดตั้ง): ' + FinalCredentials + #13#10 + 'ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก และให้ลบไฟล์นี้หลังส่งมอบรหัสผ่านแล้ว';
  FinalMessage := FinalMessage + #13#10 + #13#10 + 'ไฟล์ใบรับรองสำหรับติดตั้งบนเครื่องอื่น (ถ้า Browser เตือน): ' + ResultValue('certificateDownload');
  if FinalWarnings <> '' then FinalMessage := FinalMessage + #13#10 + #13#10 + 'สิ่งที่ต้องทราบ / ตั้งค่าเพิ่ม:' + FinalWarnings;
end;

procedure MakeShortcuts;
var Body: String; Dir: String;
begin
  if IsParityRehearsal then Exit;
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
      SuppressibleMsgBox(FinalMessage, mbError, MB_OK, IDOK);
      DelTree(ExpandConstant('{tmp}'+chr(92)+'nipt-package'), True, True, True);
      ExitProcess(2);                       { a failed install/upgrade must not look like success to the caller }
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
    if FileExists(Node) and FileExists(Cli) then Exec(Node, Params, ExpandConstant('{sys}'), SW_HIDE, ewWaitUntilTerminated, Code);
    if DeleteAllData then begin Sleep(3000); RemoveDir(Root); end;   { nothing may keep the empty folder }
  end;
end;

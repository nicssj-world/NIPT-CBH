<#
.SYNOPSIS  Starts the NIPT-CBH native Excel bridge for this installation. Run as an INTERACTIVE user (scheduled task at logon), never as SYSTEM.
.DESCRIPTION
  Task List PDFs are rendered by the desktop Microsoft Excel (COM). Excel automation is not supported in a non-interactive session
  (session 0 / SYSTEM service) and the export script reads the signed-in user's default printer (HKCU). When the application runs as a
  SYSTEM startup task, the web process therefore hands each export to this bridge through the spool folder <Root>\data\excel-spool; the bridge
  runs in a logged-on user's session, calls the unchanged export script and returns the PDFs. No network listener is opened.
  The release folder is resolved from install-state.json at start, so restart this task after an upgrade or rollback (the installer does).
#>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Root)
$ErrorActionPreference='Stop'
# ONE bridge per installation on the whole machine, whichever session started it (the task also starts every 2 minutes while none is running, and the
# logon trigger fires in every session). A second instance would read and answer the same spool jobs twice, so it simply exits.
$sha=[Security.Cryptography.SHA256]::Create()
$key=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(([IO.Path]::GetFullPath($Root)).TrimEnd('\').ToLowerInvariant())))).Replace('-','').Substring(0,24)
$created=$false;$mutex=$null
try{$mutex=New-Object System.Threading.Mutex($true,"Global\NIPT-CBH-ExcelBridge-$key",[ref]$created)}catch{$mutex=New-Object System.Threading.Mutex($true,"Local\NIPT-CBH-ExcelBridge-$key",[ref]$created)}
if(-not $created){exit 0}
$state=Get-Content -LiteralPath (Join-Path $Root 'install-state.json') -Raw | ConvertFrom-Json
$release=Join-Path (Join-Path $Root 'releases') $state.current.version
$spool=Join-Path (Join-Path $Root 'data') 'excel-spool'
$pwsh=Join-Path $Root 'runtime\pwsh\pwsh.exe'
if(-not (Test-Path -LiteralPath $pwsh)){$pwsh=(Get-Command pwsh.exe -ErrorAction Stop).Source}
$bridge=Join-Path $release 'ops\tools\operational\native-excel-bridge.ps1'
$export=Join-Path $release 'ops\packages\workbook\native-export.ps1'
foreach($f in @($bridge,$export)){if(-not (Test-Path -LiteralPath $f -PathType Leaf)){throw "EXCEL_BRIDGE_FILE_MISSING: $f"}}
& $pwsh -NoLogo -NoProfile -File $bridge -Root $spool -ExportScript $export
exit $LASTEXITCODE

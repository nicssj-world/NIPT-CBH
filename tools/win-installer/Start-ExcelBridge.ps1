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

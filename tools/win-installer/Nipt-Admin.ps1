<#
.SYNOPSIS  Operator entry point for the NIPT-CBH Windows installation.
.EXAMPLE   .\Nipt-Admin.ps1 status -Root C:\NIPT-CBH
.EXAMPLE   .\Nipt-Admin.ps1 backup -Root C:\NIPT-CBH
.EXAMPLE   .\Nipt-Admin.ps1 upgrade -Root C:\NIPT-CBH -Package D:\media\nipt-cbh-1.1.0-app -PublicKey D:\media\package-signing-public.pem
Commands: verify-package preflight install start stop restart status health backup restore upgrade rollback uninstall
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory,Position=0)][ValidateSet('verify-package','preflight','install','start','stop','restart','status','health','backup','restore','upgrade','rollback','uninstall','host-check','office-check')][string]$Command,
  [string]$Root='C:\NIPT-CBH',
  [string]$Package,
  [string]$PublicKey,
  [Parameter(ValueFromRemainingArguments)][string[]]$Rest
)
$ErrorActionPreference='Stop'
$here=Split-Path -Parent $MyInvocation.MyCommand.Path
# Inside a package the bundled Node runs the installer; inside an installation the installed Node runs the installed admin tool.
$packageNode=Join-Path (Split-Path -Parent $here) 'payload\runtime\node\node.exe'
$installedNode=Join-Path $Root 'runtime\node\node.exe'
$node=if(Test-Path -LiteralPath $packageNode){$packageNode}elseif(Test-Path -LiteralPath $installedNode){$installedNode}else{throw 'NODE_RUNTIME_NOT_FOUND: run from an unpacked package or an installed root'}
$cli=Join-Path $here 'nipt-admin.mjs'
$argv=@($cli,$Command,'--root',$Root)
if($Package){$argv+=@('--package',$Package)}
elseif($Command -in 'install','preflight','verify-package' -and (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $here) 'manifest.json'))){$argv+=@('--package',(Split-Path -Parent $here))}
if($PublicKey){$argv+=@('--public-key',$PublicKey)}
if($Rest){$argv+=$Rest}
& $node @argv
exit $LASTEXITCODE

<#
.SYNOPSIS  Offline installation of NIPT-CBH on this Windows host. The profile follows the signed package: a production package creates the two first accounts from -AdminUser/-CheckerUser (no test accounts); a test package creates six test accounts.
.DESCRIPTION
  Verifies the signed package against a public key you obtained separately, checks the host, copies the bundled Node/PostgreSQL/Chromium
  runtimes, creates a private PostgreSQL cluster, applies the forward migrations, creates the first accounts for the package profile, registers a startup task,
  starts the services and takes the first verified backup. No internet access, Docker or HIS connection is used.
  A SYSTEM startup task needs an elevated prompt; without elevation use -TaskMode user (starts at logon of the installing user).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Install-Nipt.ps1 -Root C:\NIPT-CBH -PublicKey E:\keys\package-signing-public.pem -MasterWorkbook D:\owner\NIPT_CBH_Final_Combined_Master.xlsx -TaskMode system
#>
[CmdletBinding()]
param(
  [string]$Root='C:\NIPT-CBH',
  [Parameter(Mandatory)][string]$PublicKey,
  [Parameter(Mandatory)][string]$MasterWorkbook,
  [ValidateSet('user','system')][string]$TaskMode='system',
  [string]$Instance='nipt-cbh',
  [string]$Ports='5432,3000,443,3001',
  [string]$Origin,
  [string]$AdminUser,[string]$AdminName,[string]$CheckerUser,[string]$CheckerName
)
$ErrorActionPreference='Stop'
$here=Split-Path -Parent $MyInvocation.MyCommand.Path
$extra=@('--master-workbook',$MasterWorkbook,'--task-mode',$TaskMode,'--instance',$Instance,'--ports',$Ports)
if($Origin){$extra+=@('--origin',$Origin)}
foreach($pair in @(@('--admin-user',$AdminUser),@('--admin-name',$AdminName),@('--checker-user',$CheckerUser),@('--checker-name',$CheckerName))){if($pair[1]){$extra+=@($pair[0],$pair[1])}}
& (Join-Path $here 'Nipt-Admin.ps1') install -Root $Root -PublicKey $PublicKey -Rest $extra
exit $LASTEXITCODE

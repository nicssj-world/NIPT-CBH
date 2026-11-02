<#
.SYNOPSIS  ONE command to upgrade PRODUCTION to a commit. Shows how risky the change is, asks for ONE typed confirmation, then does everything else.
.DESCRIPTION
  What the owner does:      powershell -ExecutionPolicy Bypass -File C:\NIPT-CBH\deploy\upgrade-production.ps1
                            (or  ... -Commit <40-hex>  for a specific commit; default is the tip of the release branch)
  Windows asks for UAC once (administrator rights are required by Windows). Then:
   1. the change since the installed release is classified LOW / MEDIUM / HIGH from the Git difference (deploy-production.ps1 prints why);
   2. LOW and MEDIUM are validated here (typecheck, lint, related tests; MEDIUM adds the PDF / report / dashboard render tests) - no Staging run;
      HIGH (database, patient identity, results, HIS, authentication, the deployment engine) still needs the Staging verification of that exact commit;
   3. you type  DEPLOY PRODUCTION <first 7 of the commit>  once;
   4. verified pre-upgrade backup through the service identity, forward migrations, release switch, health check, automatic rollback of the application;
   5. a step-by-step timing is printed, and the Excel bridge is checked and restarted if it is not running.
  A console click ("Select ..." in the title) can no longer pause it: that mode is switched off. Nothing here lowers a safety check.
#>
[CmdletBinding()]
param(
  [ValidatePattern('^[0-9a-f]{40}$')][string]$Commit,
  [string]$ApprovedBy = "$env:USERDOMAIN\$env:USERNAME",
  [string]$ChangeReference = ('UPGRADE-' + (Get-Date).ToString('yyyyMMdd-HHmm')),
  [string[]]$AllowDestructiveMigration = @(),
  [switch]$Elevated
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  # Windows UAC is required for the service, task and firewall changes of an upgrade: ask once, in a fresh administrator console.
  $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $MyInvocation.MyCommand.Path, '-Elevated', '-ApprovedBy', $ApprovedBy, '-ChangeReference', $ChangeReference)
  if ($Commit) { $a += @('-Commit', $Commit) }
  if ($AllowDestructiveMigration.Count) { $a += @('-AllowDestructiveMigration', ($AllowDestructiveMigration -join ',')) }
  try { Start-Process powershell.exe -Verb RunAs -ErrorAction Stop -ArgumentList $a; Write-Host 'The upgrade continues in the administrator window.' } catch { Write-Host "NOT STARTED: $($_.Exception.Message) (the UAC prompt was cancelled or timed out; run this again and answer it)" -ForegroundColor Red; exit 1 }
  exit 0
}
$AllowDestructiveMigration = @($AllowDestructiveMigration | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
Import-Module (Join-Path $here 'NiptDeploy.psm1') -Force -DisableNameChecking
Disable-NiptQuickEdit
$log = Join-Path (Get-NiptHistoryDir 'production') 'upgrade-production.log'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null
try { Start-Transcript -LiteralPath $log -Force | Out-Null } catch { }
$exit = 1
try {
  $tc = Get-NiptToolchain
  $cfg = (Read-NiptEnvironments $tc 'production').production
  Write-Host 'Fetching the release branch ...'
  try { Invoke-NiptGit $tc $tc.Source @('fetch', '--prune', 'origin') | Out-Null } catch { Write-Host "git fetch failed ($($_.Exception.Message)); using what is already here" -ForegroundColor Yellow }
  if (-not $Commit) { $Commit = Invoke-NiptGit $tc $tc.Source @('rev-parse', $cfg.releaseBranch) }
  $Commit = Resolve-NiptCommit $tc $Commit
  Write-Host "Candidate: $Commit ($($Commit.Substring(0, 7)))" -ForegroundColor Cyan
  # Diagnostics for the Excel bridge (Task Scheduler keeps no history unless this log is on). Harmless; ignored when it cannot be set.
  try { & wevtutil.exe sl 'Microsoft-Windows-TaskScheduler/Operational' /e:true 2>$null | Out-Null } catch { }
  $deploy = @{ Commit = $Commit; ApprovedBy = $ApprovedBy; ChangeReference = $ChangeReference }
  if ($AllowDestructiveMigration.Count) { $deploy.AllowDestructiveMigration = $AllowDestructiveMigration }
  & (Join-Path $here 'deploy-production.ps1') @deploy
  $exit = $LASTEXITCODE
  if ($exit -eq 0) {
    # the Excel bridge lives in the interactive session: make sure it runs after the switch (idempotent; one instance by mutex)
    try {
      $bridge = Get-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName "nipt-cbh-$($cfg.instance)-excel-bridge" -ErrorAction Stop
      if ([string]$bridge.State -ne 'Running') { Start-ScheduledTask -InputObject $bridge; Write-Host 'Excel bridge was not running: started.' -ForegroundColor Yellow }
    } catch { }
    $r = Get-NiptEnvironmentReport $cfg -Quiet
    Write-Host ("Production health: {0}{1}" -f $(if ($r.ok) { 'OK' } else { 'NOT OK' }), $(if (-not $r.ok) { " (failed: $($r.failed -join ', '))" } else { '' })) -ForegroundColor $(if ($r.ok) { 'Green' } else { 'Red' })
    if (-not $r.ok) { $exit = 1 }
  }
} catch {
  Write-Host "UPGRADE FAILED: $($_.Exception.Message)" -ForegroundColor Red
  $exit = 1
} finally { try { Stop-Transcript | Out-Null } catch { } }
Write-Host ''
Write-Host $(if ($exit -eq 0) { 'DONE. You can close this window.' } else { "NOT COMPLETED (production keeps running what it ran before unless the log says otherwise). Log: $log" }) -ForegroundColor $(if ($exit -eq 0) { 'Green' } else { 'Red' })
if ($exit -ne 0) { Read-Host 'Press Enter to close' | Out-Null }
exit $exit

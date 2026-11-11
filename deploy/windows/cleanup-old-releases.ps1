<#
.SYNOPSIS  Free disk space by removing OLD release folders and OLD build worktrees. Shows the list first; deletes only with -Apply and a typed confirmation.
.DESCRIPTION
  Owner 2026-11-11: drive C was 92% full. Every deployment leaves a release folder (~0.6 GB) in <root>\releases and a build worktree (~1.9 GB)
  in the builds folder. This keeps the newest few of each and removes the rest.

  Default is a DRY RUN: it prints what would be kept and what would be removed, with sizes, and changes nothing.

    powershell -ExecutionPolicy Bypass -File C:\NIPT-CBH\deploy\cleanup-old-releases.ps1                       (production, list only)
    powershell -ExecutionPolicy Bypass -File C:\NIPT-CBH\deploy\cleanup-old-releases.ps1 -Environment staging  (staging, list only)
    ... -KeepReleases 8 -KeepBuilds 5                                                                           (keep more)
    ... -Apply                                                                                                  (really delete; asks you to type CLEAN <environment>)

  ALWAYS kept: the installed release and the previous release (the rollback target) of the environment, and the build of the installed and
  previous revision of BOTH environments. -KeepReleases / -KeepBuilds can not go below 3.
  NEVER touched: data, database, backups, config, secrets, runtime, logs, deploy\history, the Git repository, any junction or link.
  It refuses to run while a deployment, rollback or reset is running (it takes the same deploy lock).
#>
[CmdletBinding()]
param(
  [ValidateSet('production', 'staging')][string]$Environment = 'production',
  [ValidateRange(3, 500)][int]$KeepReleases = 5,
  [ValidateRange(3, 500)][int]$KeepBuilds = 3,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking
$gb = { param($b) '{0,7:N2} GB' -f ($b / 1GB) }
try {
  $tc = Get-NiptToolchain
  $envs = Read-NiptEnvironments $tc 'staging'
  $cfg = $envs.$Environment
  if (-not (Test-NiptInstalled $cfg)) { throw "NOT_INSTALLED: $Environment has no install-state.json at $($cfg.root)" }
  if ($Apply -and -not (Test-NiptElevated)) { throw 'ADMINISTRATOR_REQUIRED: run this window as administrator to delete (a list-only run does not need it)' }
  Write-Host ("Environment: {0}   root: {1}   keep {2} release(s), {3} build(s)" -f $Environment, $cfg.root, $KeepReleases, $KeepBuilds) -ForegroundColor Cyan
  $drive = Get-PSDrive -Name ($cfg.root.Substring(0, 1)) -ErrorAction SilentlyContinue
  if ($drive) { Write-Host ("Drive {0}: free {1:N1} GB of {2:N1} GB" -f $drive.Name, ($drive.Free / 1GB), (($drive.Used + $drive.Free) / 1GB)) }
  Write-Host 'Measuring folder sizes (this can take a minute) ...'
  $plan = Get-NiptRetentionPlan $tc $cfg $KeepReleases $KeepBuilds
  foreach ($a in $plan.areas) {
    Write-Host ''
    Write-Host ("{0} folders under {1}" -f $a.kind, $a.path) -ForegroundColor Cyan
    Write-Host ("  KEEP ({0}):" -f @($a.kept).Count)
    foreach ($k in $a.kept) { Write-Host ("    {0}  {1}" -f $k.name, $(if ($k.reason -eq 'PROTECTED') { '[installed / previous - never removed]' } else { '[newest]' })) -ForegroundColor Green }
    Write-Host ("  REMOVE ({0}, {1}):" -f @($a.remove).Count, (& $gb $a.reclaimBytes).Trim())
    foreach ($r in $a.remove) { Write-Host ("    {0}  {1}  (last changed {2})" -f (& $gb $r.bytes), $r.name, ([DateTimeOffset]::FromUnixTimeMilliseconds([long]$r.modifiedMs).ToLocalTime().ToString('yyyy-MM-dd HH:mm'))) -ForegroundColor Yellow }
    if (@($a.linkSkipped).Count) { Write-Host ("  SKIPPED (junction or link, never removed): {0}" -f ($a.linkSkipped -join ', ')) -ForegroundColor Yellow }
    if (@($a.protectedMissing).Count) { Write-Host ("  note: recorded as installed/previous but not on disk: {0}" -f ($a.protectedMissing -join ', ')) -ForegroundColor Yellow }
  }
  Write-Host ''
  Write-Host ("Total that would be freed: {0}" -f (& $gb $plan.reclaimBytes).Trim()) -ForegroundColor Cyan
  if (-not $Apply) { Write-Host 'LIST ONLY - nothing was deleted. Run again with -Apply to delete.' -ForegroundColor Green; exit 0 }
  if ($plan.reclaimBytes -eq 0) { Write-Host 'Nothing to remove.'; exit 0 }
  $phrase = "CLEAN $Environment"
  $typed = Read-Host "Type exactly  $phrase  to delete the folders listed under REMOVE"
  if ($typed -cne $phrase) { Write-Host 'Not confirmed. Nothing was deleted.' -ForegroundColor Yellow; exit 0 }
  $lock = Enter-NiptDeployLock   # refuses while a deployment, rollback or reset is running
  try {
    $result = Invoke-NiptRetention $tc $plan -Apply
    Write-Host ''
    Write-Host ("Removed {0} folder(s), freed {1}." -f @($result.removed).Count, (& $gb $result.reclaimedBytes).Trim()) -ForegroundColor Green
    foreach ($f in $result.failed) { Write-Host ("Could not remove {0} {1}: {2}" -f $f.kind, $f.name, $f.error) -ForegroundColor Red }
    if ($drive) { $d2 = Get-PSDrive -Name $drive.Name; Write-Host ("Drive {0}: free {1:N1} GB" -f $d2.Name, ($d2.Free / 1GB)) }
    exit $(if (@($result.failed).Count) { 1 } else { 0 })
  } finally { $lock.Dispose() }
} catch {
  Write-Host "CLEANUP STOPPED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

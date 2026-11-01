<#
.SYNOPSIS  Read-only status of Staging and/or Production: services, health, release, schema version, environment boundary.
.DESCRIPTION
  For each environment: installed engine status + health + schema (migration ledger vs the active release), the environment stamp,
  the database's own environment marker and the deployed application version / release ID / commit. Changes nothing, takes no lock.
  Exit code 0 only when every selected environment is healthy.
.EXAMPLE   .\deploy\health-check.ps1
.EXAMPLE   .\deploy\health-check.ps1 -Environment production -Json C:\NIPT-CBH\deploy\history\production\health-latest.json
#>
[CmdletBinding()]
param(
  [ValidateSet('staging', 'production', 'all')][string]$Environment = 'all',
  [string]$Json
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking

$tc = Get-NiptToolchain
$envs = Read-NiptEnvironments $tc
$names = if ($Environment -eq 'all') { @('staging', 'production') } else { @($Environment) }
$reports = [ordered]@{}
$allOk = $true
foreach ($n in $names) {
  $cfg = $envs.$n
  $r = Get-NiptEnvironmentReport $cfg -Quiet
  $reports[$n] = $r
  if (-not $r.ok) { $allOk = $false }
  Write-Host ''
  Write-Host ("== {0}  ({1})" -f $n.ToUpper(), $cfg.root) -ForegroundColor Cyan
  if (-not $r.installed) { Write-Host '   not installed' -ForegroundColor Yellow; continue }
  $rel = $r.status.release
  Write-Host ("   release     {0}   commit {1}   app {2}" -f $rel.version, $rel.revision, ($rel.version -split '-')[0])
  Write-Host ("   previous    {0}" -f $(if ($r.status.previous) { $r.status.previous.version } else { '(none)' }))
  Write-Host ("   schema      {0} applied, last {1}, pending {2}, compatible {3}" -f $r.schema.applied, $r.schema.last, @($r.schema.pending).Count, $r.schema.compatibleWithDatabase)
  Write-Host ("   services    supervisor {0}, postgres {1}, task {2}" -f $r.status.supervisorProcess, $r.status.postgresProcess, $(if ($r.status.task) { $r.status.task.state } else { 'NOT_REGISTERED' }))
  Write-Host ("   boundary    stamp {0}, config {1}, database marker {2}" -f $(if ($r.stamp) { $r.stamp.environment } else { 'MISSING' }), $r.status.environment, $r.status.databaseMarker)
  Write-Host ("   backup      {0}   last {1}" -f $r.health.backupStatus, $r.status.lastBackup)
  if ($r.ok) { Write-Host '   HEALTHY' -ForegroundColor Green } else { Write-Host ("   NOT HEALTHY: {0}  {1}" -f ($r.failed -join ', '), $(if ($r.health.PSObject.Properties['failed']) { 'health failed: ' + (@($r.health.failed) -join ', ') })) -ForegroundColor Red }
}
if ($Json) { Write-NiptJson ([ordered]@{ checkedAt = (Get-Date).ToString('o'); host = $env:COMPUTERNAME; ok = $allOk; environments = $reports }) $Json }
exit $(if ($allOk) { 0 } else { 1 })

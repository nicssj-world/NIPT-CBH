<#
.SYNOPSIS  Switch PRODUCTION back to its previous application release (application only; the database and clinical evidence are kept).
.DESCRIPTION
  Uses the installed engine's rollback: it refuses (ROLLBACK_REQUIRES_DATABASE_RESTORE) when the database holds a migration the previous
  release does not know, or a migration whose checksum differs - an application rollback is never a database rollback. In that case
  nothing is changed and Production keeps running the current release; recovering an older schema is a separate, authorised restore.
  A short service stop of Production only (Staging is untouched). The release that was rolled back stays on disk.
.EXAMPLE   .\deploy\rollback-production.ps1 -Reason "Task List PDF regression, CR-2026-11-02"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Reason,
  [string]$Confirmation
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking

$lock = Enter-NiptDeployLock
$run = Start-NiptRun 'production' 'rollback'
$detail = [ordered]@{ reason = $Reason }
try {
  $tc = Get-NiptToolchain
  $cfg = (Read-NiptEnvironments $tc).production
  if (-not (Test-NiptInstalled $cfg)) { throw 'PRODUCTION_NOT_INSTALLED' }
  Assert-NiptCanVerifyServices $cfg
  $status = Invoke-NiptAdmin $cfg 'status' -Quiet
  if (-not $status.PSObject.Properties['previous'] -or -not $status.previous) { throw 'NO_PREVIOUS_RELEASE: nothing to roll back to' }
  $detail.from = $status.release; $detail.to = $status.previous
  if ($status.environment -ne 'production') { throw "NOT_A_PRODUCTION_INSTALLATION: $($status.environment)" }

  $schema = Invoke-NiptAdmin $cfg 'schema' -Quiet
  $detail.schemaBefore = [ordered]@{ applied = $schema.applied; last = $schema.last }
  Write-Host ''
  Write-Host "PRODUCTION rollback: $($status.release.version) ($($status.release.revision.Substring(0,7))) -> $($status.previous.version) ($($status.previous.revision.Substring(0,7)))" -ForegroundColor Yellow
  Write-Host "Database stays at $($schema.applied) migration(s), last $($schema.last). The engine refuses if the previous release cannot run on it."
  $phrase = "ROLLBACK PRODUCTION $($status.previous.revision.Substring(0,7))"
  if (-not $Confirmation) { $Confirmation = Read-Host "Type exactly: $phrase" }
  if ($Confirmation -ne $phrase) { throw 'ROLLBACK_CONFIRMATION_PHRASE_REQUIRED' }

  $engine = Invoke-NiptAdmin $cfg 'rollback'
  Assert-NiptEngineOk $engine 'ROLLBACK'
  $report = Get-NiptEnvironmentReport $cfg
  $detail.report = [ordered]@{ ok = $report.ok; failed = $report.failed; release = $report.status.release }
  if (-not $report.ok) { throw "PRODUCTION_NOT_HEALTHY_AFTER_ROLLBACK: $($report.failed -join ',')" }
  Complete-NiptRun $run 'SUCCEEDED' $detail
  Write-Host "PRODUCTION now runs $($report.status.release.version) ($($report.status.release.revision))." -ForegroundColor Green
  exit 0
} catch {
  $detail.error = $_.Exception.Message
  Complete-NiptRun $run 'FAILED' $detail
  Write-Host "PRODUCTION rollback FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.Exception.Message -match 'ROLLBACK_REQUIRES_DATABASE_RESTORE') { Write-Host 'The current release is still running. An older schema needs an authorised restore (see README-DEPLOYMENT.md, "Database rollback").' -ForegroundColor Yellow }
  Write-Host "Log: $(Join-Path $run.directory 'run.log')"
  exit 1
} finally { $lock.Dispose() }

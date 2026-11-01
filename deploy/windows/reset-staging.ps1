<#
.SYNOPSIS  Return STAGING to a clean, reproducible synthetic state. Production is never read or touched.
.DESCRIPTION
  The engine command reset-staging refuses unless the configuration, the environment stamp, the test profile AND the database's own
  marker all say Staging. It drops and re-provisions only the Staging database (same six UAT accounts), sets the old Staging file store
  and simulator folders aside under staging\backups\reset-<time> (never deleted), restarts Staging and checks health.
  -Seed then runs the existing installed synthetic journey (tools\win-installer\installed-journey.ts: 45 test patients through HIS PET
  simulator files, Request/Consent, Lab Run, Pooling, Sequencing, Results, release and outbound RES/PDF into Staging folders only) from
  the build worktree of the commit Staging runs, and records the result as that commit's workflow UAT.
.EXAMPLE   .\deploy\reset-staging.ps1 -Seed
#>
[CmdletBinding()]
param(
  [switch]$Seed,
  [string]$Confirmation
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking

$lock = Enter-NiptDeployLock
$run = Start-NiptRun 'staging' 'reset'
$detail = [ordered]@{}
try {
  $tc = Get-NiptToolchain
  $envs = Read-NiptEnvironments $tc
  $cfg = $envs.staging
  if (-not (Test-NiptInstalled $cfg)) { throw 'STAGING_NOT_INSTALLED' }
  Assert-NiptCanVerifyServices $cfg
  # belt and braces before the engine's own checks: never a path or port of Production
  if ($cfg.root -eq $envs.production.root -or $cfg.ports.postgres -eq $envs.production.ports.postgres) { throw 'STAGING_DEFINITION_POINTS_AT_PRODUCTION' }
  $status = Invoke-NiptAdmin $cfg 'status' -Quiet
  if ($status.environment -ne 'staging' -or -not $status.databaseMarkerOk) { throw "NOT_A_MARKED_STAGING_DATABASE: environment=$($status.environment) marker=$($status.databaseMarker)" }
  $commit = $status.release.revision; $detail.release = $status.release
  if (-not $Confirmation) { $Confirmation = Read-Host 'Type exactly: RESET STAGING' }

  $engine = Invoke-NiptAdmin $cfg 'reset-staging' @('--confirm', $Confirmation)
  Assert-NiptEngineOk $engine 'RESET'
  $detail.setAside = $engine.setAside; $detail.provision = $engine.provision

  if ($Seed) {
    $wt = Get-NiptBuildWorktree $tc $commit
    if (-not (Test-Path -LiteralPath (Join-Path $wt 'node_modules\tsx'))) { throw "BUILD_WORKTREE_HAS_NO_DEPENDENCIES: $wt (redeploy this commit to Staging)" }
    $out = Join-Path $run.directory 'journey'
    $j = Invoke-NiptProcess -File $tc.Node -Arguments @('--import', 'tsx', 'tools/win-installer/installed-journey.ts', '--root', $cfg.root, '--out', $out) -WorkingDirectory $wt -Environment (Get-NiptJourneyEnvironment $tc $cfg) -Step 'seed: installed synthetic journey'
    $journey = [ordered]@{ passed = ($j.ExitCode -eq 0); commit = $commit; evidence = $out; at = (Get-Date).ToString('o') }
    $detail.journey = $journey
    $vf = Get-NiptVerifiedFile $commit
    if (Test-Path -LiteralPath $vf) {
      $v = Read-NiptJson $vf
      Add-Member -InputObject $v -NotePropertyName journey -NotePropertyValue $journey -Force
      Write-NiptJson $v $vf
    }
    if (-not $journey.passed) { throw "SEED_JOURNEY_FAILED: evidence $out" }
  }
  Complete-NiptRun $run 'SUCCEEDED' $detail
  Write-Host "STAGING reset$(if($Seed){' and seeded'}). Old synthetic files: $($engine.setAside)" -ForegroundColor Green
  exit 0
} catch {
  $detail.error = $_.Exception.Message
  Complete-NiptRun $run 'FAILED' $detail
  Write-Host "STAGING reset FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log: $(Join-Path $run.directory 'run.log')"
  exit 1
} finally { $lock.Dispose() }

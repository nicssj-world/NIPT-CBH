<#
.SYNOPSIS  Build one exact commit and deploy it to STAGING (never Production).
.DESCRIPTION
  1. Resolves -Ref to a full commit in C:\NIPT-CBH\source\NIPT-CBH (uncommitted changes are never deployed and are reported).
  2. Creates a clean detached build worktree at that commit, runs npm ci (lockfile) and the validation steps.
  3. Builds the signed TEST-profile package with the repository's build-package.ts (Staging signing key).
  4. First time: installs C:\NIPT-CBH\staging as environment "staging" (own PostgreSQL cluster, ports, secrets, task).
     Afterwards: upgrades it through the installed engine (verified pre-upgrade backup, forward migrations, release switch,
     health check, automatic rollback to the previous release if the new one is not healthy).
  5. Verifies health, schema, environment stamp and database marker, then records the result. A successful run writes
     history\staging\verified\<commit>.json, which is what deploy-production.ps1 requires.
  Only Staging services are stopped. Nothing here reads Production secrets or writes under the Production root.
.EXAMPLE   .\deploy\deploy-staging.ps1                      # HEAD of the source checkout
.EXAMPLE   .\deploy\deploy-staging.ps1 -Ref feat/my-change -Validation quick
.EXAMPLE   .\deploy\deploy-staging.ps1 -Ref 1ad1f340bde071549f004b091de498c10fb5beb8 -AppVersion 1.1.2
#>
[CmdletBinding()]
param(
  [string]$Ref = 'HEAD',
  [string]$AppVersion,
  [ValidateSet('full', 'quick')][string]$Validation = 'full',
  [switch]$RunJourney
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking

$lock = Enter-NiptDeployLock
$run = Start-NiptRun 'staging' 'deploy'
$detail = [ordered]@{}
try {
  $tc = Get-NiptToolchain
  $envs = Read-NiptEnvironments $tc
  $cfg = $envs.staging; $other = $envs.production
  Assert-NiptCanVerifyServices $cfg
  Assert-NiptStagingStarted $cfg

  $commit = Resolve-NiptCommit $tc $Ref
  $detail.ref = $Ref; $detail.commit = $commit
  $dirty = Invoke-NiptGit $tc $tc.Source @('status', '--porcelain', '--untracked-files=normal')
  if ($dirty) { Write-NiptLog 'the source checkout has uncommitted changes: they are NOT part of this deployment (only the commit is built)' 'WARN' }
  $appVersion = Resolve-NiptAppVersion $tc $commit $AppVersion
  $rid = (Invoke-NiptGate 'release-id' $tc @{ appVersion = $appVersion; commit = $commit }).releaseId
  if (-not $rid) { throw 'RELEASE_ID_FAILED' }
  $detail.appVersion = $appVersion; $detail.releaseId = $rid
  Write-NiptLog "commit $commit  application $appVersion  release $rid"

  $wt = Get-NiptBuildWorktree $tc $commit
  $detail.worktree = $wt
  Assert-NiptAssets $wt $cfg
  $detail.validation = @(Invoke-NiptValidation $tc $wt $Validation)

  $public = Initialize-NiptSigningKey $tc $cfg
  $installed = Test-NiptInstalled $cfg
  $pkg = New-NiptPackage $tc $wt $rid $cfg -AppOnly:$installed
  $detail.package = [ordered]@{ dir = $pkg.dir; version = $pkg.version; profile = $pkg.profile; payloadDigest = $pkg.payloadDigest; migrationsSha256 = $pkg.migrationsSha256; migrationCount = $pkg.migrationCount; buildId = $pkg.buildId }
  if ($pkg.revision -ne $commit -or $pkg.profile -ne 'test') { throw "PACKAGE_IDENTITY_MISMATCH: revision $($pkg.revision) profile $($pkg.profile)" }

  if (-not $installed) {
    Write-NiptLog "first deployment: installing $($cfg.root) as environment staging"
    $engine = Invoke-NiptAdmin $cfg 'install' (Get-NiptInstallArguments $cfg $other $pkg.dir $public) -Node (Join-Path $pkg.dir 'payload\runtime\node\node.exe') -Cli (Join-Path $pkg.dir 'installer\nipt-admin.mjs') -WorkingDirectory $pkg.dir
    Assert-NiptEngineOk $engine 'INSTALL'
    $detail.mode = 'INSTALL'
  } else {
    $before = Invoke-NiptAdmin $cfg 'status' -Quiet
    $detail.previousRelease = $before.release
    $engine = Invoke-NiptAdmin $cfg 'upgrade' @('--package', $pkg.dir, '--public-key', $public)
    Assert-NiptEngineOk $engine 'UPGRADE'
    $detail.mode = 'UPGRADE'; $detail.migrationsApplied = $engine.pendingMigrationsApplied; $detail.preUpgradeBackup = $engine.preUpgradeBackup
  }

  $report = Get-NiptEnvironmentReport $cfg
  $detail.report = [ordered]@{ ok = $report.ok; failed = $report.failed; release = $report.status.release; schemaApplied = $report.schema.applied; schemaLast = $report.schema.last }
  if (-not $report.ok) { throw "STAGING_NOT_HEALTHY_AFTER_DEPLOY: $($report.failed -join ',')" }
  if ($report.status.release.revision -ne $commit) { throw "STAGING_RUNS_DIFFERENT_REVISION: $($report.status.release.revision)" }

  $journey = $null
  if ($RunJourney) {
    Write-NiptLog 'workflow UAT: installed synthetic journey (45 test patients, HIS simulator folders only)' 'STEP'
    $out = Join-Path $run.directory 'journey'
    $j = Invoke-NiptProcess -File $tc.Node -Arguments @('--import', 'tsx', 'tools/win-installer/installed-journey.ts', '--root', $cfg.root, '--out', $out) -WorkingDirectory $wt -Environment (Get-NiptJourneyEnvironment $tc $cfg) -Step 'journey'
    $journey = [ordered]@{ passed = ($j.ExitCode -eq 0); commit = $commit; evidence = $out; at = (Get-Date).ToString('o') }
    if ($j.ExitCode -ne 0) { Write-NiptLog "workflow UAT FAILED (evidence $out); the deployment stands but Production stays blocked for this commit" 'WARN' }
  }
  $detail.journey = $journey

  # the record deploy-production.ps1 requires: same commit, same payload digest, migrations rehearsed here
  $verified = [ordered]@{ format = 'NIPT_STAGING_VERIFIED_V1'; commit = $commit; appVersion = $appVersion; releaseId = $rid; outcome = 'SUCCEEDED'; verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
    runId = $run.runId; payloadDigest = $pkg.payloadDigest; buildId = $pkg.buildId; migrationsSha256 = $pkg.migrationsSha256; health = [ordered]@{ ok = $report.health.ok }
    schema = [ordered]@{ ok = $report.schema.ok; applied = $report.schema.applied; last = $report.schema.last; ledger = $report.schema.ledger }; journey = $journey; worktree = $wt }
  Write-NiptJson $verified (Get-NiptVerifiedFile $commit)
  Complete-NiptRun $run 'SUCCEEDED' $detail
  Write-Host ''
  Write-Host "STAGING now runs $rid (commit $commit). Open: https://localhost:$($cfg.ports.https)" -ForegroundColor Green
  if (-not $RunJourney) { Write-Host 'Workflow UAT not run: .\deploy\reset-staging.ps1 -Seed  (or redeploy with -RunJourney) before promoting to Production.' -ForegroundColor Yellow }
  exit 0
} catch {
  $detail.error = $_.Exception.Message
  try { $cfgNow = (Read-NiptEnvironments (Get-NiptToolchain)).staging; if (Test-NiptInstalled $cfgNow) { $detail.afterFailure = (Invoke-NiptAdmin $cfgNow 'status' -Quiet).release } } catch { }
  Complete-NiptRun $run 'FAILED' $detail
  Write-Host "STAGING deployment FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log: $(Join-Path $run.directory 'run.log')"
  exit 1
} finally { $lock.Dispose() }

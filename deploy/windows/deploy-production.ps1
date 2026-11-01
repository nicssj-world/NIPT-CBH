<#
.SYNOPSIS  Promote ONE Staging-verified commit to PRODUCTION. Never runs from a Staging build, a Git pull or an edit.
.DESCRIPTION
  Refuses unless ALL hold (deploy-gates.mjs productionGate, every failure is listed):
   - history\staging\verified\<commit>.json exists, is recent, healthy, schema-current and (by default) has a passed workflow UAT;
   - the commit is on the release branch (production.json releaseBranch, e.g. origin/main; run "git fetch" yourself first);
   - the Production package's release payload is byte-identical (digest) to the one verified on Staging;
   - every migration Production is about to run already ran on Staging with the same checksum; destructive SQL is named in
     -AllowDestructiveMigration; the Production ledger is compatible;
   - -ApprovedBy, -ChangeReference and the typed confirmation "DEPLOY PRODUCTION <first 7 of the commit>".
  The upgrade itself is the installed engine's: verified pre-upgrade backup, forward migrations, release switch, health check,
  automatic rollback when the new release is not healthy. The previous release stays in C:\NIPT-CBH\production\releases.
.EXAMPLE
  .\deploy\deploy-production.ps1 -Commit 1ad1f340bde071549f004b091de498c10fb5beb8 -ApprovedBy "Owner name" -ChangeReference "CR-2026-11-01"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$Commit,
  [Parameter(Mandatory)][string]$ApprovedBy,
  [Parameter(Mandatory)][string]$ChangeReference,
  [string]$Confirmation,
  [string[]]$AllowDestructiveMigration = @()
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking

$lock = Enter-NiptDeployLock
$run = Start-NiptRun 'production' 'deploy'
$detail = [ordered]@{ commit = $Commit; approvedBy = $ApprovedBy; changeReference = $ChangeReference }
try {
  $tc = Get-NiptToolchain
  $envs = Read-NiptEnvironments $tc
  $cfg = $envs.production; $staging = $envs.staging
  Assert-NiptCanVerifyServices $cfg

  if ((Resolve-NiptCommit $tc $Commit) -ne $Commit) { throw 'COMMIT_UNRESOLVED' }
  $verifiedFile = Get-NiptVerifiedFile $Commit
  $verified = if (Test-Path -LiteralPath $verifiedFile) { Read-NiptJson $verifiedFile } else { $null }
  if (-not $verified) { throw "STAGING_VERIFICATION_MISSING: deploy this commit to Staging first (.\deploy\deploy-staging.ps1 -Ref $Commit)" }
  $rid = $verified.releaseId; $detail.releaseId = $rid; $detail.appVersion = $verified.appVersion

  $onBranch = $true
  try { Invoke-NiptGit $tc $tc.Source @('merge-base', '--is-ancestor', $Commit, $cfg.releaseBranch) | Out-Null } catch { $onBranch = $false }

  if (-not $Confirmation) {
    Write-Host ''
    Write-Host "PRODUCTION deployment of $rid (commit $Commit) to $($cfg.root)" -ForegroundColor Yellow
    $Confirmation = Read-Host "Type exactly: DEPLOY PRODUCTION $($Commit.Substring(0,7))"
  }

  # the Production package is built from the SAME worktree and the SAME Next build that Staging verified (no rebuild)
  $wt = Get-NiptBuildWorktree $tc $Commit
  if (-not (Test-Path -LiteralPath (Join-Path $wt '.next\BUILD_ID'))) { throw 'VERIFIED_BUILD_MISSING: the Staging build worktree no longer holds its build; redeploy the commit to Staging' }
  if ((Get-Content -LiteralPath (Join-Path $wt '.next\BUILD_ID') -Raw).Trim() -ne $verified.buildId) { throw 'VERIFIED_BUILD_REPLACED: the worktree build is not the one Staging verified; redeploy the commit to Staging' }
  $public = Initialize-NiptSigningKey $tc $cfg
  $installed = Test-NiptInstalled $cfg
  $pkg = New-NiptPackage $tc $wt $rid $cfg -AppOnly:$installed -SkipBuild
  $detail.package = [ordered]@{ dir = $pkg.dir; version = $pkg.version; profile = $pkg.profile; payloadDigest = $pkg.payloadDigest; migrationsSha256 = $pkg.migrationsSha256 }
  if ($pkg.revision -ne $Commit -or $pkg.profile -ne 'production' -or $pkg.testEnvironmentOnly) { throw "PACKAGE_IDENTITY_MISMATCH: revision $($pkg.revision) profile $($pkg.profile)" }

  $ledger = $null
  if ($installed) {
    $schema = Invoke-NiptAdmin $cfg 'schema' -Quiet
    if (-not $schema.PSObject.Properties['ledger']) { throw "PRODUCTION_SCHEMA_UNREADABLE: $($schema.error)" }
    $ledger = @($schema.ledger)
    $detail.previousRelease = $schema.release
  }
  $pendingSql = @{}
  foreach ($name in $pkg.migrations.PSObject.Properties.Name) {
    $f = Join-Path $pkg.dir "payload\release\ops\db\migrations\$name"
    if (Test-Path -LiteralPath $f) { $pendingSql[$name] = Get-Content -LiteralPath $f -Raw -Encoding UTF8 }
  }
  $gate = Invoke-NiptGate 'production-gate' $tc @{
    verified = $verified; commit = $Commit; now = (Get-Date).ToUniversalTime().ToString('o'); maxAgeDays = $cfg.stagingVerifiedMaxAgeDays
    requireJourney = -not ($cfg.PSObject.Properties['requireStagingJourney'] -and $cfg.requireStagingJourney -eq $false); payloadDigest = $pkg.payloadDigest; release = @{ migrationsSha256 = $pkg.migrationsSha256; migrations = $pkg.migrations }
    onReleaseBranch = $onBranch; approvedBy = $ApprovedBy; changeReference = $ChangeReference; confirmation = $Confirmation
    productionLedger = $ledger; pendingSql = $pendingSql; allowDestructive = $AllowDestructiveMigration
  }
  $detail.gate = $gate
  if (-not $gate.ok) {
    foreach ($f in $gate.failures) { Write-NiptLog ("gate: {0} {1}" -f $f.code, $(if ($f.PSObject.Properties['detail']) { ConvertTo-Json $f.detail -Compress -Depth 6 })) 'FAIL' }
    throw 'PRODUCTION_GATE_REFUSED'
  }
  Write-NiptLog "gate passed: $(@($gate.pending).Count) pending migration(s): $(@($gate.pending) -join ', ')" 'OK'

  if (-not $installed) {
    Write-NiptLog "first Production installation into $($cfg.root)"
    $engine = Invoke-NiptAdmin $cfg 'install' (Get-NiptInstallArguments $cfg $staging $pkg.dir $public) -Node (Join-Path $pkg.dir 'payload\runtime\node\node.exe') -Cli (Join-Path $pkg.dir 'installer\nipt-admin.mjs') -WorkingDirectory $pkg.dir
    Assert-NiptEngineOk $engine 'INSTALL'
    $detail.mode = 'INSTALL'; $detail.firstBackup = $engine.firstBackup
    Write-Host "First sign-in credentials (one-time, deliver then delete): $($engine.credentials)" -ForegroundColor Yellow
  } else {
    $engine = Invoke-NiptAdmin $cfg 'upgrade' @('--package', $pkg.dir, '--public-key', $public)
    Assert-NiptEngineOk $engine 'UPGRADE'
    $detail.mode = 'UPGRADE'; $detail.migrationsApplied = $engine.pendingMigrationsApplied; $detail.preUpgradeBackup = $engine.preUpgradeBackup
  }

  $report = Get-NiptEnvironmentReport $cfg
  $detail.report = [ordered]@{ ok = $report.ok; failed = $report.failed; release = $report.status.release; schemaApplied = $report.schema.applied; schemaLast = $report.schema.last }
  if (-not $report.ok) { throw "PRODUCTION_NOT_HEALTHY_AFTER_DEPLOY: $($report.failed -join ','); run .\deploy\health-check.ps1 -Environment production and, if needed, .\deploy\rollback-production.ps1" }
  if ($report.status.release.revision -ne $Commit) { throw "PRODUCTION_RUNS_DIFFERENT_REVISION: $($report.status.release.revision)" }
  Complete-NiptRun $run 'SUCCEEDED' $detail
  Write-Host ''
  Write-Host "PRODUCTION now runs $rid (commit $Commit). Previous release kept for rollback: $($report.status.previous.version)" -ForegroundColor Green
  exit 0
} catch {
  $detail.error = $_.Exception.Message
  try { $cfgNow = (Read-NiptEnvironments (Get-NiptToolchain)).production; if (Test-NiptInstalled $cfgNow) { $detail.afterFailure = (Invoke-NiptAdmin $cfgNow 'status' -Quiet).release } } catch { }
  Complete-NiptRun $run 'FAILED' $detail
  Write-Host "PRODUCTION deployment FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($detail.Contains('afterFailure')) { Write-Host "Production is running: $($detail.afterFailure.version) ($($detail.afterFailure.revision))" }
  Write-Host "Log: $(Join-Path $run.directory 'run.log')"
  exit 1
} finally { $lock.Dispose() }

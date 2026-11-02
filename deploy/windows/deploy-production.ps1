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
  [string[]]$AllowDestructiveMigration = @(),
  [string]$SkipValidationReason
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking

$lock = Enter-NiptDeployLock
$run = Start-NiptRun 'production' 'deploy'
$detail = [ordered]@{ commit = $Commit; approvedBy = $ApprovedBy; changeReference = $ChangeReference }
try {
  $tc = Get-NiptToolchain
  $envs = Read-NiptEnvironments $tc 'production'
  $cfg = $envs.production; $staging = $envs.staging
  Assert-NiptCanVerifyServices $cfg

  if ((Resolve-NiptCommit $tc $Commit) -ne $Commit) { throw 'COMMIT_UNRESOLVED' }
  Disable-NiptQuickEdit
  $timings = [ordered]@{}; $detail.timings = $timings
  $installed = Test-NiptInstalled $cfg
  $verifiedFile = Get-NiptVerifiedFile $Commit
  $verified = if (Test-Path -LiteralPath $verifiedFile) { Read-NiptJson $verifiedFile } else { $null }

  # ---- how risky is this change? Derived only from the Git difference to the INSTALLED release; there is no switch to choose a level ----
  $t0 = Get-Date
  $base = $null; $files = @()
  if ($installed) { try { $base = [string](Invoke-NiptAdmin $cfg 'status' -Quiet).release.revision } catch { $base = $null } }
  if ($base -match '^[0-9a-f]{40}$') { $files = @(Get-NiptChangedFiles $tc $base $Commit) }
  $risk = Invoke-NiptGate 'classify' $tc @{ files = $files }
  $timings['classify change'] = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  $changedPaths = @($files | ForEach-Object { $_.path })
  $detail.risk = [ordered]@{ level = $risk.level; files = $risk.files; installedRevision = $base; reasons = @($risk.reasons | Select-Object -First 40); requires = $risk.requires }
  Write-Host ''
  Write-Host "RISK: $($risk.level) - $($risk.files) changed file(s) since the installed release ($(if ($base) { $base.Substring(0, 7) } else { 'unknown' }))" -ForegroundColor $(if ($risk.level -eq 'HIGH') { 'Red' } elseif ($risk.level -eq 'MEDIUM') { 'Yellow' } else { 'Green' })
  foreach ($r in @($risk.reasons | Select-Object -First 8)) { Write-Host ("   [{0}] {1}  ({2})" -f $r.level, $r.path, $r.rule) }
  if ($risk.reasons.Count -gt 8) { Write-Host "   ... and $($risk.reasons.Count - 8) more" }
  Write-Host ("   needs: " + $(if ($risk.requires.stagingVerification) { 'Staging verification of this exact commit' } else { 'focused validation: ' + (@($risk.requires.focusedValidation) -join '; ') }) + '; verified backup; one confirmation')
  Write-NiptLog "risk $($risk.level): $($risk.files) file(s); staging verification required = $($risk.requires.stagingVerification)"
  $detail.path = if ($verified) { 'STAGING_VERIFIED' } else { 'DIRECT_VALIDATED' }
  $appVersionNow = if ($verified) { $verified.appVersion } else { Resolve-NiptAppVersion $tc $Commit $null }
  $detail.appVersion = $appVersionNow

  $onBranch = $true
  try { Invoke-NiptGit $tc $tc.Source @('merge-base', '--is-ancestor', $Commit, $cfg.releaseBranch) | Out-Null } catch { $onBranch = $false }

  if (-not $Confirmation) {
    Write-Host ''
    Write-Host "PRODUCTION deployment of $appVersionNow (commit $Commit, risk $($risk.level)) to $($cfg.root)" -ForegroundColor Yellow
    # a stray key pressed while the window opened (a UAC click, an Enter) must not count as the answer: clear it, and ask again until the phrase is exact
    try { $Host.UI.RawUI.FlushInputBuffer() } catch { }
    $phrase = "DEPLOY PRODUCTION $($Commit.Substring(0,7))"
    for ($try = 0; $try -lt 5 -and $Confirmation -cne $phrase; $try++) {
      $Confirmation = Read-Host "Type exactly: $phrase"
      if ($Confirmation -cne $phrase) { Write-Host 'Not the exact phrase (capital letters as shown).' -ForegroundColor Yellow }
    }
  }

  $wt = Get-NiptBuildWorktree $tc $Commit
  Assert-NiptAssets $wt $cfg
  $public = Initialize-NiptSigningKey $tc $cfg
  $validatedRecord = $null
  if ($verified) {
    # Staging evidence for this exact commit: the Production package is built from the SAME worktree and the SAME Next build that Staging verified (no rebuild)
    $rid = $verified.releaseId; $detail.releaseId = $rid
    if (-not (Test-Path -LiteralPath (Join-Path $wt '.next\BUILD_ID'))) { throw 'VERIFIED_BUILD_MISSING: the Staging build worktree no longer holds its build; redeploy the commit to Staging' }
    if ((Get-Content -LiteralPath (Join-Path $wt '.next\BUILD_ID') -Raw).Trim() -ne $verified.buildId) { throw 'VERIFIED_BUILD_REPLACED: the worktree build is not the one Staging verified; redeploy the commit to Staging' }
    $detail.preflight = (Invoke-NiptPreflight $tc $wt $cfg $base) | Select-Object -Property verdict, totalMs, skipped
    $t0 = Get-Date
    $pkg = New-NiptPackage $tc $wt $rid $cfg -AppOnly:$installed -SkipBuild
    $timings['package'] = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  } else {
    # LOW or MEDIUM and no Staging evidence: focused validation of this exact commit, then build and package it here
    $stale = Get-ChildItem -LiteralPath (Join-Path $wt '.local\p8-win\packages') -Directory -Filter "*.$($Commit.Substring(0, 7))-production" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $rid = if ($stale) { $stale.Name -replace '-production$', '' } else { (Invoke-NiptGate 'release-id' $tc @{ appVersion = $appVersionNow; commit = $Commit }).releaseId }
    $detail.releaseId = $rid
    $t0 = Get-Date
    # a run that already validated THIS commit (all steps passed, under a day old, same risk level) is not repeated after a later failure such as a refused confirmation
    $prior = $null
    $priorFile = Join-Path (Join-Path (Get-NiptHistoryDir 'production') 'validated') "$Commit.json"
    if (Test-Path -LiteralPath $priorFile) { try { $prior = Read-NiptJson $priorFile } catch { $prior = $null } }
    $reuse = $prior -and $prior.format -eq 'NIPT_DIRECT_VALIDATED_V1' -and $prior.commit -eq $Commit -and $prior.risk.level -eq $risk.level -and
      @($prior.steps).Count -gt 0 -and @(@($prior.steps) | Where-Object { $_.exitCode -ne 0 }).Count -eq 0 -and (((Get-Date).ToUniversalTime() - [datetime]::Parse($prior.validatedAt).ToUniversalTime()).TotalHours -lt 20)
    if ($SkipValidationReason) {
      # Owner request (no users yet; the full test suite ran and passed before the commit). Nothing else is skipped: backup, migrations, health check and rollback stay.
      Write-Host "VALIDATION SKIPPED at the owner's request: $SkipValidationReason" -ForegroundColor Yellow
      Write-NiptLog "validation skipped at owner request: $SkipValidationReason" 'WARN'
      # the dependencies are still installed (the build needs them) and the deploy contracts still run: both take about a minute
      $steps = @(Invoke-NiptValidation $tc $wt 'quick') + @([pscustomobject]@{ step = "test run skipped at owner request: $SkipValidationReason"; exitCode = 0; seconds = 0 })
    } elseif ($reuse) {
      Write-Host "Validation of this commit already passed at $($prior.validatedAt); not repeated." -ForegroundColor Green
      $steps = @($prior.steps)
    } else {
    $steps = @(Invoke-NiptValidation $tc $wt 'quick') + @(Invoke-NiptFocusedValidation $tc $wt $risk.level $changedPaths)
    }
    $timings['validation'] = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    $detail.validation = $steps
    $detail.preflight = (Invoke-NiptPreflight $tc $wt $cfg $base) | Select-Object -Property verdict, totalMs, skipped
    $t0 = Get-Date
    $pkg = New-NiptPackage $tc $wt $rid $cfg -AppOnly:$installed
    $timings['build and package'] = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    $validatedRecord = [ordered]@{ format = 'NIPT_DIRECT_VALIDATED_V1'; commit = $Commit; releaseId = $rid; risk = [ordered]@{ level = $risk.level; files = $risk.files }
      steps = @($steps | ForEach-Object { [ordered]@{ step = $_.step; exitCode = $_.exitCode; seconds = $_.seconds } }); validatedAt = (Get-Date).ToUniversalTime().ToString('o'); payloadDigest = $pkg.payloadDigest; runId = $run.runId }
    Write-NiptJson $validatedRecord (Join-Path (Join-Path (Get-NiptHistoryDir 'production') 'validated') "$Commit.json")
  }
  Write-NiptLog "package ready in $($timings['package'] + $timings['build and package']) s" 'OK'
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
    if (Test-Path -LiteralPath $f) { $pendingSql[$name] = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8) } # a plain string: Get-Content adds PSPath/PSProvider properties that ConvertTo-Json -Depth 30 expands without bound
  }
  $gate = Invoke-NiptGate 'production-gate' $tc @{
    verified = $verified; validated = $validatedRecord; risk = @{ level = $risk.level }; commit = $Commit; now = (Get-Date).ToUniversalTime().ToString('o'); maxAgeDays = $cfg.stagingVerifiedMaxAgeDays
    payloadDigest = $pkg.payloadDigest; release = @{ migrationsSha256 = $pkg.migrationsSha256; migrations = $pkg.migrations }
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
    $t0 = Get-Date
    $engine = Invoke-NiptAdmin $cfg 'upgrade' @('--package', $pkg.dir, '--public-key', $public)
    $timings['upgrade (backup, migrations, switch)'] = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    Assert-NiptEngineOk $engine 'UPGRADE'
    $detail.mode = 'UPGRADE'; $detail.migrationsApplied = $engine.pendingMigrationsApplied; $detail.preUpgradeBackup = $engine.preUpgradeBackup
  }

  $t0 = Get-Date
  $report = Get-NiptEnvironmentReport $cfg
  $timings['health check'] = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
  $detail.report = [ordered]@{ ok = $report.ok; failed = $report.failed; release = $report.status.release; schemaApplied = $report.schema.applied; schemaLast = $report.schema.last }
  if (-not $report.ok) { throw "PRODUCTION_NOT_HEALTHY_AFTER_DEPLOY: $($report.failed -join ','); run .\deploy\health-check.ps1 -Environment production and, if needed, .\deploy\rollback-production.ps1" }
  if ($report.status.release.revision -ne $Commit) { throw "PRODUCTION_RUNS_DIFFERENT_REVISION: $($report.status.release.revision)" }
  Complete-NiptRun $run 'SUCCEEDED' $detail
  Write-Host ''
  Write-Host "PRODUCTION now runs $rid (commit $Commit). Previous release kept for rollback: $($report.status.previous.version)" -ForegroundColor Green
  Write-Host ('Time per step: ' + (($timings.GetEnumerator() | ForEach-Object { "$($_.Key) $($_.Value) s" }) -join '; '))
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

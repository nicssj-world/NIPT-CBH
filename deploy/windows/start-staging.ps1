<#
.SYNOPSIS  Start the installed STAGING on demand (explicit administrator action). It stays stopped otherwise, also after a reboot.
.DESCRIPTION
  Refuses, changing nothing, unless all hold:
   - the root, configuration and stamp all say "staging" (environment identity);
   - the dedicated service identity and the Staging egress firewall block exist (provision-identities.ps1, elevated).
     Staging never runs its Worker without them;
   - free commit and free physical memory leave room for Staging next to Production (thresholds: staging.json startRequires,
     default 3 GB commit / 1.5 GB physical, measured against Staging's own footprint, see STAGING-PRODUCTION-ARCHITECTURE.md).
  Then it starts only Staging's own processes through the engine (its supervisor: PostgreSQL, Worker, Web, Renderer, HTTPS) and the
  Excel bridge task in the owner's interactive session, and checks health, schema and boundary. Repeating it starts nothing twice.
.EXAMPLE   .\deploy\start-staging.ps1 -Reason "UAT of feat/xyz"
#>
[CmdletBinding()]
param([string]$Reason = 'operator start')
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking

$lock = Enter-NiptDeployLock
$run = Start-NiptRun 'staging' 'start'
$detail = [ordered]@{ reason = $Reason }
try {
  $tc = Get-NiptToolchain
  $cfg = (Read-NiptEnvironments $tc).staging
  if (-not (Test-NiptInstalled $cfg)) { throw 'STAGING_NOT_INSTALLED: deploy it first (.\deploy\deploy-staging.ps1)' }
  Assert-NiptCanVerifyServices $cfg

  # environment identity
  $stamp = Read-NiptJson (Join-Path $cfg.root 'environment.json')
  $installed = Read-NiptJson (Join-Path $cfg.root 'config\nipt.json')
  if ($stamp.environment -ne 'staging' -or $installed.environment -ne 'staging' -or $installed.testEnvironmentOnly -ne $true) { throw "STAGING_IDENTITY_MISMATCH: stamp=$($stamp.environment) config=$($installed.environment) test=$($installed.testEnvironmentOnly)" }

  # isolation layers that need an elevated provisioning: no Staging Worker without them
  $iso = Get-NiptIsolationReadiness $cfg
  $detail.isolation = $iso
  if (-not $iso.ready) { throw "STAGING_ISOLATION_INCOMPLETE: $($iso.missing -join ', ') - run .\deploy\provision-identities.ps1 -Environment staging from an elevated prompt" }

  # resources: Production must keep its headroom
  $need = [ordered]@{ commitFreeGB = 3.0; physicalFreeGB = 1.5 }
  if ($cfg.PSObject.Properties['startRequires'] -and $cfg.startRequires) { foreach ($k in @($need.Keys)) { if ($cfg.startRequires.PSObject.Properties[$k]) { $need[$k] = [double]$cfg.startRequires.$k } } }
  $mem = Get-NiptMemory
  $detail.memoryBefore = $mem; $detail.requires = $need
  $already = (Get-NiptOwnedProcesses $cfg).Count -gt 0
  if (-not $already -and ($mem.commitFreeGB -lt $need.commitFreeGB -or $mem.physicalFreeGB -lt $need.physicalFreeGB)) {
    throw ("INSUFFICIENT_MEMORY_FOR_STAGING: commit free {0} GB (needs {1}), physical free {2} GB (needs {3}). Close desktop applications or raise the pagefile (README-DEPLOYMENT.md, 'Memory')" -f $mem.commitFreeGB, $need.commitFreeGB, $mem.physicalFreeGB, $need.physicalFreeGB)
  }

  # start only Staging's own processes
  Assert-NiptEngineOk (Invoke-NiptAdmin $cfg 'start') 'START'
  $tasks = Get-NiptTaskNames $cfg
  if (-not (Get-NiptBridgeState $cfg).alive) {
    Remove-Item -LiteralPath (Join-Path $cfg.root 'data\excel-spool\stop.request') -Force -ErrorAction SilentlyContinue
    Enable-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $tasks.bridge -ErrorAction Stop | Out-Null
    Start-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $tasks.bridge -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds(60); while (-not (Get-NiptBridgeState $cfg).alive -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  }
  $bridge = Get-NiptBridgeState $cfg
  $detail.bridge = $bridge
  if (-not $bridge.alive) { throw 'EXCEL_BRIDGE_NOT_RUNNING: the bridge runs in the signed-in owner session; sign in on the console and retry' }

  # health: the engine probes until healthy or its timeout
  $deadline = (Get-Date).AddSeconds(180)
  do { $report = Get-NiptEnvironmentReport $cfg -Quiet; if (-not $report.ok) { Start-Sleep -Seconds 5 } } while (-not $report.ok -and (Get-Date) -lt $deadline)
  $detail.report = [ordered]@{ ok = $report.ok; failed = $report.failed; release = $report.status.release }
  $owned = Get-NiptOwnedProcesses $cfg
  $detail.owned = [ordered]@{ count = $owned.Count; privateMB = [int](($owned | Measure-Object privateMB -Sum).Sum) }
  $detail.memoryAfter = Get-NiptMemory
  Set-NiptStagingIntent 'RUNNING' $Reason
  if (-not $report.ok) { throw "STAGING_STARTED_BUT_UNHEALTHY: $($report.failed -join ',') - inspect with .\deploy\staging-status.ps1, stop with .\deploy\stop-staging.ps1" }
  Complete-NiptRun $run 'SUCCEEDED' $detail
  Write-Host ("STAGING RUNNING {0}  release {1}  commit {2}  HEALTHY  ({3} processes, {4} MB private; commit {5}/{6} GB)" -f $installed.origin, $report.status.release.version, $report.status.release.revision, $detail.owned.count, $detail.owned.privateMB, $detail.memoryAfter.commitUsedGB, $detail.memoryAfter.commitLimitGB) -ForegroundColor Green
  exit 0
} catch {
  $detail.error = $_.Exception.Message
  Complete-NiptRun $run 'FAILED' $detail
  Write-Host "STAGING start REFUSED/FAILED: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally { $lock.Dispose() }

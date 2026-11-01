<#
.SYNOPSIS  Stop STAGING on purpose (on-demand Staging): drain, stop every Staging-owned process, keep all data, stay stopped across reboots.
.DESCRIPTION
  1. Reports the Staging job queue and waits (-DrainSeconds) for active jobs to finish; jobs still queued or active are reported, never
     discarded: pg-boss keeps them in the Staging database and the Worker picks them up again at the next start (an active job is
     retried after its expiry).
  2. Engine stop (nipt-admin stop): the Worker drains over its IPC channel, then Web, Renderer and HTTPS stop, then PostgreSQL stops with
     a fast shutdown (checkpoint). Database, files, secrets, logs and evidence stay where they are.
  3. Stops the Excel bridge through its own stop request, then its task.
  4. Disables both Staging scheduled tasks, so neither a logon nor a reboot starts Staging again (start-staging.ps1 re-enables them).
  5. Confirms no process from C:\NIPT-CBH\staging\runtime remains, and that Production and the unrelated PostgreSQL service are unchanged.
  Safe to run repeatedly. It never stops a process that is not Staging's own.
.EXAMPLE   .\deploy\stop-staging.ps1 -Reason "UAT finished"
#>
[CmdletBinding()]
param([string]$Reason = 'operator stop', [int]$DrainSeconds = 120)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking

$lock = Enter-NiptDeployLock
$run = Start-NiptRun 'staging' 'stop'
$detail = [ordered]@{ reason = $Reason }
try {
  $tc = Get-NiptToolchain
  $envs = Read-NiptEnvironments $tc
  $cfg = $envs.staging; $prod = $envs.production
  if (-not (Test-NiptInstalled $cfg)) { throw 'STAGING_NOT_INSTALLED' }
  Assert-NiptCanVerifyServices $cfg
  $tasks = Get-NiptTaskNames $cfg
  $pgService = (Get-Service postgresql-x64-17 -ErrorAction SilentlyContinue).Status
  $prodBefore = if (Test-NiptInstalled $prod) { [string](Get-Content -LiteralPath (Join-Path $prod.root 'run\supervisor.lock') -ErrorAction SilentlyContinue) } else { 'NOT_INSTALLED' }
  $detail.memoryBefore = Get-NiptMemory
  $owned = @(Get-NiptOwnedProcesses $cfg)
  $detail.ownedBefore = [ordered]@{ count = $owned.Count; privateMB = [int](($owned | Measure-Object privateMB -Sum).Sum) }

  # 1. drain
  $backlog = Get-NiptQueueBacklog $cfg
  if ($backlog) {
    $deadline = (Get-Date).AddSeconds($DrainSeconds)
    while ($backlog.active -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 5; $backlog = Get-NiptQueueBacklog $cfg }
    $detail.queueAtStop = $backlog
    if ($backlog.active -gt 0) { Write-NiptLog "$($backlog.active) job(s) still active after $DrainSeconds s: kept in the Staging database, retried by the Worker at the next start" 'WARN' }
    if ($backlog.created + $backlog.retry -gt 0) { Write-NiptLog "$($backlog.created + $backlog.retry) queued job(s) kept for the next start" 'WARN' }
  } else { $detail.queueAtStop = 'POSTGRES_NOT_RUNNING'; Write-NiptLog 'Staging PostgreSQL was not running: nothing to drain' }

  # 2. engine stop (apps, then PostgreSQL)
  Assert-NiptEngineOk (Invoke-NiptAdmin $cfg 'stop') 'STOP'

  # 3. Excel bridge (its own stop request; the task is stopped only after the bridge has let go of Excel)
  $spool = Join-Path $cfg.root 'data\excel-spool'
  if ((Get-NiptBridgeState $cfg).alive) {
    Set-Content -LiteralPath (Join-Path $spool 'stop.request') -Value 'stop' -Encoding ascii
    $deadline = (Get-Date).AddSeconds(30); while ((Get-NiptBridgeState $cfg).alive -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
  }
  Stop-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $tasks.bridge -ErrorAction SilentlyContinue

  # 4. stay stopped: no logon or startup trigger may reactivate Staging
  foreach ($t in $tasks.supervisor, $tasks.bridge) { Disable-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $t -ErrorAction Stop | Out-Null }

  # 5. verify
  $deadline = (Get-Date).AddSeconds(30)
  do { $left = @(Get-NiptOwnedProcesses $cfg); if ($left.Count) { Start-Sleep -Seconds 2 } } while ($left.Count -and (Get-Date) -lt $deadline)
  $detail.ownedAfter = @($left | ForEach-Object { "$($_.name)#$($_.pid)" })
  if ($left.Count) { throw "STAGING_PROCESSES_STILL_RUNNING: $($detail.ownedAfter -join ', ') (see README-DEPLOYMENT.md, 'Staging does not stop')" }
  $taskStates = @(foreach ($t in $tasks.supervisor, $tasks.bridge) { (Get-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $t).State })
  $detail.taskStates = $taskStates
  if (@($taskStates | Where-Object { "$_" -ne 'Disabled' }).Count) { throw "STAGING_TASK_NOT_DISABLED: $($taskStates -join ',')" }
  $prodAfter = if (Test-NiptInstalled $prod) { [string](Get-Content -LiteralPath (Join-Path $prod.root 'run\supervisor.lock') -ErrorAction SilentlyContinue) } else { 'NOT_INSTALLED' }
  $pgServiceAfter = (Get-Service postgresql-x64-17 -ErrorAction SilentlyContinue).Status
  $detail.untouched = [ordered]@{ production = "$prodBefore -> $prodAfter"; 'postgresql-x64-17' = "$pgService -> $pgServiceAfter" }
  if ("$prodBefore" -ne "$prodAfter" -or "$pgService" -ne "$pgServiceAfter") { throw "UNRELATED_SERVICE_CHANGED: $($detail.untouched | ConvertTo-Json -Compress)" }
  $detail.memoryAfter = Get-NiptMemory

  Set-NiptStagingIntent 'STOPPED' $Reason
  Complete-NiptRun $run 'SUCCEEDED' $detail
  Write-Host ("STAGING STOPPED (intentional). Owned processes {0} -> 0 ({1} MB private released). Commit {2} -> {3} GB of {4} GB. Data kept in {5}." -f $detail.ownedBefore.count, $detail.ownedBefore.privateMB, $detail.memoryBefore.commitUsedGB, $detail.memoryAfter.commitUsedGB, $detail.memoryAfter.commitLimitGB, $cfg.root) -ForegroundColor Green
  exit 0
} catch {
  $detail.error = $_.Exception.Message
  Complete-NiptRun $run 'FAILED' $detail
  Write-Host "STAGING stop FAILED: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Log: $(Join-Path $run.directory 'run.log')"
  exit 1
} finally { $lock.Dispose() }

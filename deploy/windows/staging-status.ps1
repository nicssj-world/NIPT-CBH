<#
.SYNOPSIS  Read-only state of the on-demand STAGING: RUNNING / STOPPED / PARTIAL / UNHEALTHY, and why. Starts nothing, takes no lock.
.DESCRIPTION
  Derived from the processes that really run from C:\NIPT-CBH\staging\runtime, the engine's own state, the Excel bridge heartbeat
  and (only when Staging runs) the engine health/schema probes. An intentional stop (stop-staging.ps1) is reported as
  "STOPPED (intentional)": it is not an incident. Also shows memory/commit, release and commit SHA, queued jobs, isolation readiness
  and the latest synthetic workflow UAT for the release Staging holds. Exit code 0 for RUNNING or an intentional STOPPED, 1 otherwise.
.EXAMPLE   .\deploy\staging-status.ps1
#>
[CmdletBinding()]
param([string]$Json)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking

$tc = Get-NiptToolchain
$cfg = (Read-NiptEnvironments $tc).staging
if (-not (Test-NiptInstalled $cfg)) { Write-Host 'STAGING NOT INSTALLED'; exit 1 }
$intent = Get-NiptStagingIntent
$state = Read-NiptJson (Join-Path $cfg.root 'install-state.json')
$owned = Get-NiptOwnedProcesses $cfg
$byName = $owned | Group-Object name | ForEach-Object { "$($_.Name) x$($_.Count)" }
$lockFile = Join-Path $cfg.root 'run\supervisor.lock'
$supPid = if (Test-Path -LiteralPath $lockFile) { [int](Get-Content -LiteralPath $lockFile -Raw) } else { 0 }
$supervisor = [bool]($supPid -and ($owned | Where-Object pid -eq $supPid))
$postgres = [bool]($owned | Where-Object name -eq 'postgres.exe')
$services = [ordered]@{}
$svcState = Join-Path $cfg.root 'run\state.json'
if ($supervisor -and (Test-Path -LiteralPath $svcState)) { foreach ($p in (Read-NiptJson $svcState).services.PSObject.Properties) { $services[$p.Name] = $(if ($owned | Where-Object pid -eq $p.Value.pid) { 'RUNNING' } else { 'NOT_RUNNING' }) } }
$bridge = Get-NiptBridgeState $cfg
$report = $null; $backlog = $null
if ($supervisor) { $report = Get-NiptEnvironmentReport $cfg -Quiet }
if ($postgres) { $backlog = Get-NiptQueueBacklog $cfg }
$overall = if (-not $owned.Count) { 'STOPPED' } elseif (-not ($supervisor -and $postgres -and $bridge.alive -and $services.Count -and -not @($services.Values | Where-Object { $_ -ne 'RUNNING' }).Count)) { 'PARTIAL' } elseif ($report -and $report.ok) { 'RUNNING' } else { 'UNHEALTHY' }
$label = if ($overall -eq 'STOPPED') { if ($intent.state -eq 'STOPPED') { 'STOPPED (intentional)' } else { 'STOPPED (not by stop-staging.ps1)' } } else { $overall }
$iso = Get-NiptIsolationReadiness $cfg
$mem = Get-NiptMemory
$vf = Get-NiptVerifiedFile $state.current.revision
$uat = if (Test-Path -LiteralPath $vf) { $v = Read-NiptJson $vf; if ($v.PSObject.Properties['journey'] -and $v.journey) { "passed=$($v.journey.passed) at $($v.journey.at)" } else { 'not run for this release' } } else { 'no Staging verification for this release' }
$tasks = Get-NiptTaskNames $cfg
$taskStates = foreach ($t in $tasks.supervisor, $tasks.bridge) { $x = Get-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $t -ErrorAction SilentlyContinue; "$t=$(if($x){$x.State}else{'MISSING'})" }

Write-Host ''
Write-Host ("STAGING  {0}" -f $label) -ForegroundColor $(switch ($overall) { 'RUNNING' { 'Green' } 'STOPPED' { if ($intent.state -eq 'STOPPED') { 'Gray' } else { 'Yellow' } } default { 'Red' } })
Write-Host ("  operator intent   {0} since {1} by {2} ({3})" -f $intent.state, $intent.at, $intent.by, $(if ($intent.PSObject.Properties['reason']) { $intent.reason }))
Write-Host ("  release           {0}   commit {1}" -f $state.current.version, $state.current.revision)
Write-Host ("  processes         {0} ({1} MB private)  {2}" -f $owned.Count, [int](($owned | Measure-Object privateMB -Sum).Sum), ($byName -join ', '))
Write-Host ("  supervisor        {0}   postgres {1}   services {2}" -f $(if ($supervisor) { 'RUNNING' } else { 'STOPPED' }), $(if ($postgres) { 'RUNNING' } else { 'STOPPED' }), $(if ($services.Count) { ($services.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' ' } else { '-' }))
Write-Host ("  excel bridge      {0}" -f $bridge.state)
Write-Host ("  tasks             {0}" -f ($taskStates -join '  '))
Write-Host ("  health            {0}" -f $(if ($report) { if ($report.ok) { 'HEALTHY' } else { 'FAILED: ' + ($report.failed -join ',') } } else { 'not probed (Staging not running)' }))
Write-Host ("  queued jobs       {0}" -f $(if ($backlog) { "created=$($backlog.created) retry=$($backlog.retry) active=$($backlog.active)" } else { 'n/a (PostgreSQL stopped; jobs stay in the database)' }))
Write-Host ("  isolation         {0}" -f $(if ($iso.ready) { 'READY (identity + egress block)' } else { 'INCOMPLETE: ' + ($iso.missing -join ', ') }))
Write-Host ("  workflow UAT      {0}" -f $uat)
Write-Host ("  memory            commit {0}/{1} GB (free {2}), physical free {3}/{4} GB, pagefile {5} MB" -f $mem.commitUsedGB, $mem.commitLimitGB, $mem.commitFreeGB, $mem.physicalFreeGB, $mem.physicalTotalGB, $mem.pagefileMB)
if ($Json) { Write-NiptJson ([ordered]@{ at = (Get-Date).ToString('o'); state = $overall; label = $label; intent = $intent; release = $state.current; processes = @($owned); supervisor = $supervisor; postgres = $postgres; services = $services; bridge = $bridge; health = $report; queue = $backlog; isolation = $iso; uat = $uat; memory = $mem; tasks = @($taskStates) }) $Json }
exit $(if ($overall -eq 'RUNNING' -or ($overall -eq 'STOPPED' -and $intent.state -eq 'STOPPED')) { 0 } else { 1 })

<#
.SYNOPSIS  (Re)registers the Excel bridge scheduled task with the reliable definition and starts it if it is not running. Administrator rights required (Windows).
.DESCRIPTION
  Same definition as the engine's registerBridgeTask: hidden window (no console to close), logon trigger plus a start attempt every 2 minutes while none runs,
  MultipleInstances IgnoreNew, no time limit. Start-ExcelBridge.ps1 holds a machine-wide mutex, so a second instance never runs. Idempotent.
  The installed engine only restarts the task on an upgrade; this brings an older definition up to date (upgrade-production.ps1 calls it).
#>
[CmdletBinding()]
param([string]$Root = 'C:\NIPT-CBH\production', [string]$TaskName = 'nipt-cbh-nipt-cbh-excel-bridge', [string]$User = "$env:USERDOMAIN\$env:USERNAME")
$ErrorActionPreference = 'Stop'
$pwsh = Join-Path $Root 'runtime\pwsh\pwsh.exe'; $script = Join-Path $Root 'admin\Start-ExcelBridge.ps1'
foreach ($f in @($pwsh, $script)) { if (-not (Test-Path -LiteralPath $f)) { throw "EXCEL_BRIDGE_FILE_MISSING: $f" } }
$existing = Get-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Principal.UserId) { $User = $existing.Principal.UserId }
$a = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Root `"$Root`"" -WorkingDirectory $Root
$t = @((New-ScheduledTaskTrigger -AtLogOn -User $User), (New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)))
$s = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$p = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -TaskPath '\NIPT-CBH\' -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null
if ((Get-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $TaskName).State -ne 'Running') { Start-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $TaskName }
Write-Host "Excel bridge task $TaskName registered for $User (hidden, restarts every 2 minutes if not running, one instance)." -ForegroundColor Green

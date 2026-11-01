<#
.SYNOPSIS  ELEVATED, infrastructure only: give each installed environment its own Windows identity, NTFS boundary and (Staging) egress block.
.DESCRIPTION
  Run once after the first deployment of an environment, and again after a reinstall. For each selected, installed environment
  that names a serviceAccount in environments\<name>.json:
   1. creates (or re-keys) the LOCAL account - no domain identity, so it cannot authenticate to hospital HIS/NAS shares;
      the random password is used once to register the task and is never stored;
   2. NTFS: removes inherited access on the environment root; Administrators, SYSTEM and the deploying administrator keep Full;
      the account gets Read on the root, Modify on data, logs and run, Read on secrets; the OTHER environment's account gets an
      explicit Deny; no Users / Authenticated Users / Everyone entry remains;
   3. binds the environment's HIS share grants (config\share-policy.json) to the account (Staging enforces them);
   4. moves the supervisor task to the account, started at system startup (no logon needed); the Excel bridge task stays in the
      owner's interactive session (desktop Excel cannot run in a service session);
   5. Staging only: outbound Windows Firewall block for Staging's node.exe, postgres.exe and pwsh.exe to every non-loopback address.
      (SMB file access is made by the Windows kernel, not by node.exe: the share boundary is the local-only identity, the ACLs and
      the application's own fail-closed path checks - see STAGING-PRODUCTION-ARCHITECTURE.md.)
  Services of the environment are stopped and restarted; the other environment is not touched.
.EXAMPLE   .\deploy\provision-identities.ps1 -Environment staging
#>
[CmdletBinding()]
param([ValidateSet('staging', 'production', 'all')][string]$Environment = 'all')
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking
if (-not (Test-NiptElevated)) { Write-Host 'ELEVATED_PROMPT_REQUIRED: run from "Run as administrator" PowerShell.' -ForegroundColor Red; exit 1 }

function New-NiptPassword {
  $bytes = New-Object byte[] 30; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  # base64 + one of each class, so any local password policy accepts it
  ([Convert]::ToBase64String($bytes) -replace '[+/=]', 'x') + 'aA1!'
}
function Invoke-Icacls([string[]]$Arguments) {
  $r = Invoke-NiptProcess -File (Join-Path $env:SystemRoot 'System32\icacls.exe') -Arguments $Arguments -Step ("icacls " + ($Arguments -join ' '))
  if ($r.ExitCode -ne 0) { throw "ICACLS_FAILED: $($Arguments -join ' '): $($r.StdOut) $($r.StdErr)" }
}

$lock = Enter-NiptDeployLock
$tc = Get-NiptToolchain
$envs = Read-NiptEnvironments $tc
$names = if ($Environment -eq 'all') { @('staging', 'production') } else { @($Environment) }
$owner = "$env:USERDOMAIN\$env:USERNAME"
$failed = $false
try {
  foreach ($n in $names) {
    $cfg = $envs.$n; $other = $envs.$(if ($n -eq 'staging') { 'production' } else { 'staging' })
    $run = Start-NiptRun $n 'provision-identity'
    $detail = [ordered]@{}
    try {
      if (-not $cfg.serviceAccount) { throw 'NO_SERVICE_ACCOUNT_CONFIGURED' }
      if (-not (Test-NiptInstalled $cfg)) { throw 'ENVIRONMENT_NOT_INSTALLED: deploy it first' }
      $acct = "$env:COMPUTERNAME\$($cfg.serviceAccount)"; $detail.account = $acct

      Assert-NiptEngineOk (Invoke-NiptAdmin $cfg 'stop') 'STOP'

      $password = New-NiptPassword
      $secure = ConvertTo-SecureString $password -AsPlainText -Force
      if (Get-LocalUser -Name $cfg.serviceAccount -ErrorAction SilentlyContinue) {
        Set-LocalUser -Name $cfg.serviceAccount -Password $secure -PasswordNeverExpires $true -UserMayChangePassword $false
        Write-NiptLog "re-keyed local account $acct"
      } else {
        New-LocalUser -Name $cfg.serviceAccount -Password $secure -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires -Description "NIPT-CBH $n runtime services (no interactive use)" | Out-Null
        Write-NiptLog "created local account $acct"
      }

      $root = $cfg.root
      Invoke-Icacls @($root, '/inheritance:r', '/grant:r', '*S-1-5-32-544:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', "${owner}:(OI)(CI)F", "${acct}:(OI)(CI)RX")
      foreach ($d in 'data', 'logs', 'run') { Invoke-Icacls @((Join-Path $root $d), '/grant', "${acct}:(OI)(CI)M") }
      Invoke-Icacls @((Join-Path $root 'secrets'), '/grant', "${acct}:(OI)(CI)R")
      if ($other.serviceAccount -and (Get-LocalUser -Name $other.serviceAccount -ErrorAction SilentlyContinue)) {
        Invoke-Icacls @($root, '/deny', "$env:COMPUTERNAME\$($other.serviceAccount):(OI)(CI)F")
        if (Test-Path -LiteralPath $other.root) { Invoke-Icacls @($other.root, '/deny', "${acct}:(OI)(CI)F") }
      }
      foreach ($broad in '*S-1-1-0', '*S-1-5-11', '*S-1-5-32-545') { Invoke-Icacls @($root, '/remove:g', $broad) }

      $policyFile = Join-Path $root 'config\share-policy.json'
      $policy = Read-NiptJson $policyFile
      foreach ($g in $policy.grants) { $g.serviceAccount = $acct.ToLowerInvariant() }
      Write-NiptJson $policy $policyFile
      Write-NiptJson ([ordered]@{ account = $acct.ToLowerInvariant(); environment = $n; provisionedAt = (Get-Date).ToString('o'); by = $owner }) (Join-Path $root 'config\service-identity.json')

      $task = "nipt-cbh-$($cfg.instance)"
      Set-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $task -Trigger (New-ScheduledTaskTrigger -AtStartup) -User $acct -Password $password | Out-Null
      $password = $null; $secure = $null
      $detail.task = $task
      Write-NiptLog "supervisor task $task now runs as $acct at system startup"

      if ($n -eq 'staging') {
        $nonLoopback = @('0.0.0.0-126.255.255.255', '128.0.0.0-255.255.255.255', '::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
        foreach ($p in @('runtime\node\node.exe', 'runtime\pg\bin\postgres.exe', 'runtime\pwsh\pwsh.exe')) {
          $program = Join-Path $root $p
          if (-not (Test-Path -LiteralPath $program)) { continue }
          $name = "NIPT-CBH Staging egress block ($(Split-Path -Leaf $program))"
          Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
          New-NetFirewallRule -DisplayName $name -Description 'Staging may only talk to this machine (loopback). Created by provision-identities.ps1.' -Direction Outbound -Action Block -Program $program -RemoteAddress $nonLoopback -Profile Any | Out-Null
          Write-NiptLog "firewall: $name"
        }
        $detail.egressBlocked = $true
      }

      Assert-NiptEngineOk (Invoke-NiptAdmin $cfg 'start') 'START'
      $report = Get-NiptEnvironmentReport $cfg
      $detail.health = [ordered]@{ ok = $report.ok; failed = $report.failed }
      if (-not $report.ok) { throw "NOT_HEALTHY_UNDER_SERVICE_IDENTITY: $($report.failed -join ',')" }
      Complete-NiptRun $run 'SUCCEEDED' $detail
    } catch {
      $failed = $true; $detail.error = $_.Exception.Message
      Complete-NiptRun $run 'FAILED' $detail
      Write-Host "$n FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
  }
} finally { $lock.Dispose() }
exit $(if ($failed) { 1 } else { 0 })

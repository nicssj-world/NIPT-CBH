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
# "Log on as a batch job" (a stored-password scheduled task needs it; a new local account does not have it by default)
function Grant-NiptBatchLogonRight([string]$Account) {
  if (-not ('NiptLsa' -as [type])) {
    Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Security.Principal;
public static class NiptLsa {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct LSA_UNICODE_STRING { public ushort Length, MaximumLength; public string Buffer; }
  [StructLayout(LayoutKind.Sequential)] struct LSA_OBJECT_ATTRIBUTES { public int Length; public IntPtr RootDirectory, ObjectName; public uint Attributes; public IntPtr SecurityDescriptor, SecurityQualityOfService; }
  [DllImport("advapi32.dll")] static extern uint LsaOpenPolicy(IntPtr system, ref LSA_OBJECT_ATTRIBUTES attr, uint access, out IntPtr handle);
  [DllImport("advapi32.dll")] static extern uint LsaAddAccountRights(IntPtr handle, byte[] sid, LSA_UNICODE_STRING[] rights, uint count);
  [DllImport("advapi32.dll")] static extern uint LsaClose(IntPtr handle);
  [DllImport("advapi32.dll")] static extern int LsaNtStatusToWinError(uint status);
  public static void Grant(string account, string right) {
    var sid = (SecurityIdentifier)new NTAccount(account).Translate(typeof(SecurityIdentifier));
    var bytes = new byte[sid.BinaryLength]; sid.GetBinaryForm(bytes, 0);
    var attr = new LSA_OBJECT_ATTRIBUTES(); IntPtr h;
    uint s = LsaOpenPolicy(IntPtr.Zero, ref attr, 0x00000811, out h); // POLICY_CREATE_ACCOUNT | POLICY_LOOKUP_NAMES | POLICY_VIEW_LOCAL_INFORMATION
    if (s != 0) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(s));
    try {
      var r = new LSA_UNICODE_STRING { Buffer = right, Length = (ushort)(right.Length * 2), MaximumLength = (ushort)(right.Length * 2 + 2) };
      s = LsaAddAccountRights(h, bytes, new[] { r }, 1);
      if (s != 0) throw new System.ComponentModel.Win32Exception(LsaNtStatusToWinError(s));
    } finally { LsaClose(h); }
  }
}
'@
  }
  [NiptLsa]::Grant($Account, 'SeBatchLogonRight')
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

      # The password is random, used once to register the tasks and never stored. Re-running must not rotate it needlessly: it is
      # replaced only when the account is missing, a task is not yet bound to it, or the Production NAS credential still has to be
      # stored under it (which needs the password once).
      $task = "nipt-cbh-$($cfg.instance)"
      $existing = Get-LocalUser -Name $cfg.serviceAccount -ErrorAction SilentlyContinue
      $bound = { param($name) $x = Get-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $name -ErrorAction SilentlyContinue; [bool]($x -and $x.Principal.UserId -match "(^|\\)$([regex]::Escape($cfg.serviceAccount))$" -and [string]$x.Principal.LogonType -eq 'Password') }
      $wantsNas = ($n -eq 'production' -and $cfg.PSObject.Properties['backup'] -and $cfg.backup)
      $nasDone = $false
      if ($wantsNas) { $pf = Join-Path $cfg.root 'run\nas-probe.json'; $nasDone = (Test-Path -LiteralPath $pf) -and [bool]((Get-Content -LiteralPath $pf -Raw | ConvertFrom-Json).ok) -and (& $bound "$task-backup") }
      $needKey = (-not $existing) -or -not (& $bound $task) -or ($wantsNas -and -not $nasDone)
      $password = $null; $secure = $null
      if ($needKey) {
        $password = New-NiptPassword
        $secure = ConvertTo-SecureString $password -AsPlainText -Force
        if ($existing) {
          Set-LocalUser -Name $cfg.serviceAccount -Password $secure -PasswordNeverExpires $true -UserMayChangePassword $false
          Write-NiptLog "re-keyed local account $acct"
        } else {
          New-LocalUser -Name $cfg.serviceAccount -Password $secure -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires -Description "NIPT-CBH $n runtime (non-interactive)" | Out-Null
          Write-NiptLog "created local account $acct"
        }
      } else { Write-NiptLog "account $acct and its tasks are already provisioned: credentials kept as they are" }

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

      Grant-NiptBatchLogonRight $acct
      Write-NiptLog "granted 'Log on as a batch job' to $acct"
      if ($password) {
        Set-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $task -Trigger (New-ScheduledTaskTrigger -AtStartup) -User $acct -Password $password | Out-Null
        Write-NiptLog "supervisor task $task now runs as $acct at system startup"
      }
      $detail.task = $task

      # Production NAS backup (environments\production.json "backup"): the service identity itself authenticates to the NAS with a
      # credential kept in ITS OWN Windows Credential Manager (typed here, never written to a file or to Git), and the daily backup
      # runs as that identity at its scheduled time, with or without anyone signed in.
      if ($wantsNas -and $needKey) {
        $b = $cfg.backup
        if ($b.root -notmatch '^\\\\[^\\]+\\[^\\]+') { throw "BACKUP_ROOT_MUST_BE_UNC: $($b.root)" }
        $nasServer = ($b.root -split '\\')[2]
        $svcCred = New-Object Management.Automation.PSCredential($acct, $secure)
        Write-Host ''
        $nasPassword = Read-Host "NAS password for '$($b.nasUser)' on \\$nasServer (stored only in $acct's Windows Credential Manager)" -AsSecureString
        $nasPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($nasPassword))
        $extra = if ($b.PSObject.Properties['nasTargets']) { @($b.nasTargets | Where-Object { $_ }) } else { @() }
        foreach ($t in @($nasServer) + $extra) {
          $p = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\cmdkey.exe') -ArgumentList "/add:$t", "/user:$($b.nasUser)", "/pass:$nasPlain" -Credential $svcCred -LoadUserProfile -WorkingDirectory (Join-Path $env:SystemRoot 'System32') -WindowStyle Hidden -Wait -PassThru
          if ($p.ExitCode -ne 0) { throw "NAS_CREDENTIAL_FAILED: $t exit $($p.ExitCode)" }
        }
        $nasPlain = $null; $nasPassword = $null
        Write-NiptLog "NAS credential for $($b.nasUser)@$nasServer stored for $acct"
        # proof under the service identity: write, read back and remove a temporary file on the NAS
        $probeOut = Join-Path $root 'run\nas-probe.json'; Remove-Item -LiteralPath $probeOut -ErrorAction SilentlyContinue
        $probe = "`$r=[ordered]@{at=(Get-Date).ToString('o');user=[Security.Principal.WindowsIdentity]::GetCurrent().Name};try{`$f=Join-Path '$($b.root)' ('nipt-svc-probe-'+[guid]::NewGuid().ToString('N')+'.tmp');[IO.File]::WriteAllText(`$f,'probe');`$r.readBack=([IO.File]::ReadAllText(`$f) -eq 'probe');Remove-Item -LiteralPath `$f;`$r.removed=-not (Test-Path -LiteralPath `$f);`$r.ok=(`$r.readBack -and `$r.removed)}catch{`$r.ok=`$false;`$r.error=`$_.Exception.Message};`$r|ConvertTo-Json|Set-Content -LiteralPath '$probeOut' -Encoding UTF8"
        Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList '-NoProfile', '-NonInteractive', '-Command', $probe -Credential $svcCred -LoadUserProfile -WorkingDirectory (Join-Path $env:SystemRoot 'System32') -WindowStyle Hidden -Wait | Out-Null
        $nas = if (Test-Path -LiteralPath $probeOut) { Get-Content -LiteralPath $probeOut -Raw | ConvertFrom-Json } else { $null }
        $detail.nasProbe = $nas
        if (-not $nas -or -not $nas.ok) { throw "NAS_ACCESS_AS_SERVICE_IDENTITY_FAILED: $(if ($nas) { $nas.error } else { 'no probe result' })" }
        Write-NiptLog "NAS write/read/remove as ${acct}: PASS"
        Assert-NiptEngineOk (Invoke-NiptAdmin $cfg 'set-backup-root' -Arguments @('--path', $b.root)) 'SET_BACKUP_ROOT'
        $bp = Join-Path $root 'config\backup-policy.json'; $bpol = Read-NiptJson $bp; $bpol.serviceAccount = $acct.ToLowerInvariant(); Write-NiptJson $bpol $bp
        $keep = if ($b.PSObject.Properties['keep'] -and $b.keep) { [int]$b.keep } else { 30 }
        $at = if ($b.PSObject.Properties['dailyAt'] -and $b.dailyAt) { [string]$b.dailyAt } else { '02:00' }
        Assert-NiptEngineOk (Invoke-NiptAdmin $cfg 'schedule-backup' -Arguments @('--time', $at, '--keep', [string]$keep)) 'SCHEDULE_BACKUP'
        Set-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName "$task-backup" -User $acct -Password $password | Out-Null
        $detail.backup = [ordered]@{ root = $b.root; dailyAt = $at; keep = $keep; account = $acct }
        Write-NiptLog "daily backup $at (keep $keep) to $($b.root) now runs as $acct without an interactive logon"
      }
      $password = $null; $secure = $null

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

      try { Assert-NiptEngineOk (Invoke-NiptAdmin $cfg 'start') 'START' } catch {
        $info = Get-ScheduledTaskInfo -TaskPath '\NIPT-CBH\' -TaskName $task -ErrorAction SilentlyContinue
        if ($info) { $detail.taskLastRun = [string]$info.LastRunTime; $detail.taskLastResult = ('0x{0:X8}' -f $info.LastTaskResult) }
        throw
      }
      # the Excel bridge runs in the owner's interactive session (desktop Excel cannot run in a service session); bring it up too
      $tasks = Get-NiptTaskNames $cfg
      if ($cfg.excelMode -eq 'bridge' -and (Get-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $tasks.bridge -ErrorAction SilentlyContinue)) {
        if (-not (Get-NiptBridgeState $cfg).alive) {
          Enable-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $tasks.bridge -ErrorAction Stop | Out-Null
          Start-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $tasks.bridge -ErrorAction Stop
          $deadline = (Get-Date).AddSeconds(60); while (-not (Get-NiptBridgeState $cfg).alive -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
        }
        $detail.bridge = Get-NiptBridgeState $cfg
      }      $report = Wait-NiptHealthy $cfg
      $detail.health = [ordered]@{ ok = $report.ok; failed = $report.failed }
      if (-not $report.ok) { throw "NOT_HEALTHY_UNDER_SERVICE_IDENTITY: $($report.failed -join ',')" }
      if ($detail.Contains('backup')) {
        # one real backup now, through the scheduled task itself (service identity, no interactive logon), then verify it on the NAS
        $bt = "$task-backup"; $before = (Get-ScheduledTaskInfo -TaskPath '\NIPT-CBH\' -TaskName $bt).LastRunTime
        Start-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $bt
        $deadline = (Get-Date).AddMinutes(30)
        do { Start-Sleep -Seconds 10; $ti = Get-ScheduledTaskInfo -TaskPath '\NIPT-CBH\' -TaskName $bt; $st = (Get-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName $bt).State }
        while ((Get-Date) -lt $deadline -and ([string]$st -eq 'Running' -or $ti.LastRunTime -eq $before))
        $detail.backup.firstRun = [ordered]@{ lastRun = [string]$ti.LastRunTime; result = ('0x{0:X8}' -f $ti.LastTaskResult) }
        $idx = Join-Path $cfg.backup.root 'index.json'
        $entries = if (Test-Path -LiteralPath $idx) { @(Get-Content -LiteralPath $idx -Raw | ConvertFrom-Json) } else { @() }
        $detail.backup.indexEntries = $entries.Count
        if ($ti.LastTaskResult -ne 0 -or -not $entries.Count) { throw "SCHEDULED_BACKUP_AS_SERVICE_IDENTITY_FAILED: result $($detail.backup.firstRun.result), index entries $($entries.Count)" }
        $report = Wait-NiptHealthy $cfg
        if (-not $report.ok) { throw "NOT_HEALTHY_AFTER_SCHEDULED_BACKUP: $($report.failed -join ',')" }
        Write-NiptLog "scheduled backup as ${acct}: PASS ($($entries.Count) backup(s) in $($cfg.backup.root))"
      }
      Complete-NiptRun $run 'SUCCEEDED' $detail
    } catch {
      $failed = $true; $detail.error = $_.Exception.Message
      Complete-NiptRun $run 'FAILED' $detail
      Write-Host "$n FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
  }
} finally { $lock.Dispose() }
exit $(if ($failed) { 1 } else { 0 })

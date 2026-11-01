<#
.SYNOPSIS  Evidence that Staging cannot reach Production or the hospital HIS/NAS. Read-only unless -IncludeReset.
.DESCRIPTION
  Each check is PASS, FAIL or NOT_RUN (with the reason); nothing is inferred. Evidence JSON goes to history\isolation\<time>.json.
   database   Staging's own credentials (migrator, web, worker) are REFUSED by the Production cluster; the same credentials work on Staging
              (positive control); the Production database does not exist in the Staging cluster; both clusters listen on 127.0.0.1 only.
   secrets    no Staging secret equals the Production one (compared by hash, never printed).
   runtime    the INSTALLED Staging release's boundary code, under Staging's own configuration, refuses Production folders, UNC HIS/NAS
              shares, an outside folder, a remote archive and Production's database port; it accepts its own simulator folder.
   filesystem Production root grants nothing to the Staging identity, broad groups or Everyone (and denies the Staging identity once provisioned).
   network    Staging egress firewall rules exist and block non-loopback addresses (once provisioned).
   reset      -IncludeReset: Production's release, schema ledger, configuration, install state and file-store listing are fingerprinted,
              Staging is reset, and Production is fingerprinted again - they must be identical.
  Exit code 0 = every check ran and passed; 1 = a check failed; 2 = INCOMPLETE (a check could not run: an open blocker, never a pass).
.EXAMPLE   .\deploy\test-isolation.ps1
.EXAMPLE   .\deploy\test-isolation.ps1 -IncludeReset -ResetConfirmation "RESET STAGING"
#>
[CmdletBinding()]
param([switch]$IncludeReset, [string]$ResetConfirmation)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking

$results = New-Object System.Collections.ArrayList
function Add-Result([string]$Area, [string]$Id, [ValidateSet('PASS', 'FAIL', 'NOT_RUN')][string]$State, [string]$Detail = '') {
  [void]$results.Add([pscustomobject]@{ area = $Area; id = $Id; state = $State; detail = $Detail })
}
function Test-Result([string]$Area, [string]$Id, [scriptblock]$Body) { try { & $Body } catch { Add-Result $Area $Id 'FAIL' $_.Exception.Message } }

$tc = Get-NiptToolchain
$envs = Read-NiptEnvironments $tc
$s = $envs.staging; $p = $envs.production
$sIn = Test-NiptInstalled $s; $pIn = Test-NiptInstalled $p
$secret = { param($cfg, $name) (Get-Content -LiteralPath (Join-Path $cfg.root "secrets\$name") -Raw).Trim() }
$installedConfig = { param($cfg) Read-NiptJson (Join-Path $cfg.root 'config\nipt.json') }
$psqlTry = {
  param($cfg, [int]$Port, [string]$User, [string]$Password, [string]$Database)
  Invoke-NiptProcess -File (Join-Path $cfg.root 'runtime\pg\bin\psql.exe') -Arguments @('-h', '127.0.0.1', '-p', "$Port", '-U', $User, '-d', $Database, '-X', '-A', '-t', '-w', '-c', 'SELECT current_database()') -Environment @{ PGPASSWORD = $Password; PGCONNECT_TIMEOUT = '5' } -Quiet
}

# ── database ──
if ($sIn -and $pIn) {
  $sc = & $installedConfig $s; $pc = & $installedConfig $p
  foreach ($pair in @(@('nipt_migrator', 'db-password'), @('nipt_web', 'web-password'), @('nipt_worker', 'worker-password'))) {
    $user = $pair[0]; $pw = & $secret $s $pair[1]
    Test-Result 'database' "staging-$user-refused-by-production" {
      $r = & $psqlTry $s $pc.ports.postgres $user $pw $pc.database
      if ($r.ExitCode -eq 0) { throw "STAGING_CREDENTIAL_ACCEPTED_BY_PRODUCTION: $user connected to $($pc.database)" }
      if ($r.StdErr -notmatch 'password authentication failed|does not exist|no pg_hba') { throw "UNEXPECTED_FAILURE_KIND: $($r.StdErr.Trim())" }
      Add-Result 'database' "staging-$user-refused-by-production" 'PASS' ($r.StdErr.Trim() -split "`n" | Select-Object -Last 1)
    }
    Test-Result 'database' "staging-$user-works-on-staging" {
      $r = & $psqlTry $s $sc.ports.postgres $user $pw $sc.database
      if ($r.ExitCode -ne 0) { throw "POSITIVE_CONTROL_FAILED: $($r.StdErr.Trim())" }
      Add-Result 'database' "staging-$user-works-on-staging" 'PASS' "connected to $($r.StdOut.Trim())"
    }
  }
  Test-Result 'database' 'production-database-absent-from-staging-cluster' {
    $r = Invoke-NiptProcess -File (Join-Path $s.root 'runtime\pg\bin\psql.exe') -Arguments @('-h', '127.0.0.1', '-p', "$($sc.ports.postgres)", '-U', 'nipt_migrator', '-d', 'postgres', '-X', '-A', '-t', '-w', '-c', 'SELECT datname FROM pg_database ORDER BY 1') -Environment @{ PGPASSWORD = (& $secret $s 'db-password') } -Quiet
    if ($r.ExitCode -ne 0) { throw $r.StdErr.Trim() }
    $dbs = @($r.StdOut -split "`r?`n" | Where-Object { $_ })
    if ($dbs -contains $pc.database) { throw "PRODUCTION_DATABASE_NAME_IN_STAGING_CLUSTER: $($pc.database)" }
    Add-Result 'database' 'production-database-absent-from-staging-cluster' 'PASS' ($dbs -join ',')
  }
  Test-Result 'secrets' 'no-shared-secret' {
    $shared = @(foreach ($n in 'db-password', 'web-password', 'worker-password', 'renderer-token', 'identity-lookup.key', 'backup.key', 'tls-passphrase') {
        $a = Join-Path $s.root "secrets\$n"; $b = Join-Path $p.root "secrets\$n"
        if ((Test-Path $a) -and (Test-Path $b) -and (Get-FileHash $a).Hash -eq (Get-FileHash $b).Hash) { $n } })
    if ($shared.Count) { throw "SHARED_SECRETS: $($shared -join ',')" }
    Add-Result 'secrets' 'no-shared-secret' 'PASS' 'every Staging secret differs from Production (SHA-256 compared)'
  }
} else { Add-Result 'database' 'credential-isolation' 'NOT_RUN' "needs both environments installed (staging=$sIn production=$pIn)" }

foreach ($cfg in @($s, $p)) {
  if (-not (Test-NiptInstalled $cfg)) { Add-Result 'database' "$($cfg.environment)-listener-loopback" 'NOT_RUN' 'not installed'; continue }
  Test-Result 'database' "$($cfg.environment)-listener-loopback" {
    $port = (& $installedConfig $cfg).ports.postgres
    $l = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object { $_.LocalAddress } | Sort-Object -Unique)
    if (-not $l.Count) { throw "NOT_LISTENING: $port (is the environment running?)" }
    $wide = @($l | Where-Object { $_ -notin '127.0.0.1', '::1' })
    if ($wide.Count) { throw "LISTENS_BEYOND_LOOPBACK: $($wide -join ',')" }
    Add-Result 'database' "$($cfg.environment)-listener-loopback" 'PASS' "port $port on $($l -join ',')"
  }
}

# ── runtime guard of the installed Staging release ──
if ($sIn) {
  Test-Result 'runtime' 'installed-staging-boundary' {
    $sc = & $installedConfig $s
    if ($sc.environment -ne 'staging') { throw "STAGING_INSTALLATION_HAS_NO_ENVIRONMENT_BOUNDARY: environment=$($sc.environment)" }
    $state = Read-NiptJson (Join-Path $s.root 'install-state.json')
    $module = Join-Path $s.root "releases\$($state.current.version)\ops\tools\environment-boundary.mjs"
    if (-not (Test-Path -LiteralPath $module)) { throw "BOUNDARY_MODULE_NOT_IN_INSTALLED_RELEASE: $module" }
    $probe = @'
const b=await import(process.argv[1]);const env={...process.env};const out={};
const t=(name,fn)=>{try{fn();out[name]='ALLOWED';}catch(e){out[name]=e.message;}};
t('production-files',()=>b.assertPathAllowed(process.env.PROBE_PRODUCTION+'\\data\\files',env));
t('production-outbound',()=>b.assertPathAllowed(process.env.PROBE_PRODUCTION+'\\data\\integration\\outbound',env));
t('his-unc',()=>b.assertPathAllowed('\\\\his-server\\NIPT\\PET',env));
t('nas-unc',()=>b.assertPathAllowed('\\\\hospital-nas\\NIPT\\archive',env));
t('outside-folder',()=>b.assertPathAllowed('C:\\Users\\Public',env));
t('remote-archive',()=>b.assertArchiveRootAllowed('\\\\hospital-nas\\NIPT\\archive',env));
t('admin-share-archive',()=>b.assertArchiveRootAllowed('\\\\localhost\\C$\\NIPT-CBH\\production\\data\\files',env));
t('mapped-drive',()=>b.assertPathAllowed('Z:\\HIS\\RES',env));
t('long-unc-prefix',()=>b.assertPathAllowed('\\\\?\\UNC\\his-server\\NIPT\\PET',env));
t('production-database',()=>b.assertProcessBoundary({...env,DATABASE_URL:'postgresql://nipt_web:x@127.0.0.1:'+process.env.PROBE_PRODUCTION_PORT+'/db'}));
t('own-simulator-folder',()=>b.assertPathAllowed(process.env.NIPT_ENVIRONMENT_ROOT+'\\data\\integration\\inbound',env));
console.log(JSON.stringify(out));
'@
    $vars = @{ NIPT_ENVIRONMENT = 'staging'; NIPT_ENVIRONMENT_ROOT = $s.root; NIPT_PROTECTED_ROOTS = (@($sc.protectedRoots) -join ';'); NIPT_EXPECTED_PG_PORT = "$($sc.ports.postgres)"
      NIPT_HIS_SHARE_POLICY_ENFORCE = '1'; NIPT_HIS_SHARE_POLICY_FILE = (Join-Path $s.root 'config\share-policy.json'); PROBE_PRODUCTION = $p.root; PROBE_PRODUCTION_PORT = "$($p.ports.postgres)" }
    $r = Invoke-NiptProcess -File (Join-Path $s.root 'runtime\node\node.exe') -Arguments @('--input-type=module', '-e', $probe, ([Uri]$module).AbsoluteUri) -Environment $vars -Quiet
    $o = Get-NiptLastJson $r.StdOut
    if (-not $o) { throw "PROBE_FAILED: $($r.StdErr.Trim())" }
    $leaks = @($o.PSObject.Properties | Where-Object { $_.Name -ne 'own-simulator-folder' -and $_.Value -eq 'ALLOWED' } | ForEach-Object Name)
    if ($leaks.Count) { throw "STAGING_BOUNDARY_ALLOWS: $($leaks -join ',')" }
    if ($o.'own-simulator-folder' -ne 'ALLOWED') { throw "POSITIVE_CONTROL_REFUSED: $($o.'own-simulator-folder')" }
    Add-Result 'runtime' 'installed-staging-boundary' 'PASS' (($o.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join '; ')
  }
} else { Add-Result 'runtime' 'installed-staging-boundary' 'NOT_RUN' 'Staging not installed' }

# ── filesystem ──
if ($pIn) {
  Test-Result 'filesystem' 'production-root-acl' {
    $acl = Get-Acl -LiteralPath $p.root
    $broad = @('Everyone', 'BUILTIN\Users', 'NT AUTHORITY\Authenticated Users')
    $allowBroad = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $broad -contains $_.IdentityReference.Value } | ForEach-Object { $_.IdentityReference.Value })
    if ($allowBroad.Count) { throw "PRODUCTION_ROOT_OPEN_TO: $($allowBroad -join ',') (run provision-identities.ps1 -Environment production)" }
    if ($s.serviceAccount) {
      $sid = "$env:COMPUTERNAME\$($s.serviceAccount)"
      $allow = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -ieq $sid })
      if ($allow.Count) { throw "PRODUCTION_ROOT_GRANTS_STAGING_IDENTITY: $sid" }
      $deny = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Deny' -and $_.IdentityReference.Value -ieq $sid })
      Add-Result 'filesystem' 'production-root-acl' 'PASS' ("no broad or Staging grant; explicit deny for {0}: {1}" -f $sid, $(if ($deny.Count) { 'present' } else { 'not yet (Staging identity not provisioned)' }))
    } else { Add-Result 'filesystem' 'production-root-acl' 'PASS' 'no broad grant' }
  }
} else { Add-Result 'filesystem' 'production-root-acl' 'NOT_RUN' 'Production not installed' }

# ── network ──
if ($sIn) {
  $rules = @(Get-NetFirewallRule -DisplayName 'NIPT-CBH Staging egress block*' -ErrorAction SilentlyContinue)
  if ($rules.Count) {
    $bad = @($rules | Where-Object { $_.Enabled -ne 'True' -or $_.Action -ne 'Block' -or $_.Direction -ne 'Outbound' } | ForEach-Object DisplayName)
    Add-Result 'network' 'staging-egress-block' $(if ($bad.Count) { 'FAIL' } else { 'PASS' }) $(if ($bad.Count) { "not enforcing: $($bad -join ',')" } else { "$($rules.Count) outbound block rule(s): " + (($rules | ForEach-Object DisplayName) -join ', ') })
  } else { Add-Result 'network' 'staging-egress-block' 'NOT_RUN' 'SECURITY BLOCKER: no Staging egress rule exists; run provision-identities.ps1 -Environment staging from an elevated prompt' }
  Test-Result 'identity' 'staging-service-identity' {
    $marker = Join-Path $s.root 'config\service-identity.json'
    if (-not (Test-Path -LiteralPath $marker)) { Add-Result 'identity' 'staging-service-identity' 'NOT_RUN' 'SECURITY BLOCKER: Staging still runs as the installing user; run provision-identities.ps1 -Environment staging (elevated)'; return }
    $task = Get-ScheduledTask -TaskPath '\NIPT-CBH\' -TaskName "nipt-cbh-$($s.instance)" -ErrorAction Stop
    $want = (Read-NiptJson $marker).account
    if ($task.Principal.UserId -notlike "*$($s.serviceAccount)") { throw "TASK_RUNS_AS_$($task.Principal.UserId)_NOT_$want" }
    Add-Result 'identity' 'staging-service-identity' 'PASS' "supervisor task runs as $($task.Principal.UserId)"
  }
}

# ── reset leaves Production unchanged ──
function Get-ProductionFingerprint {
  $pc = & $installedConfig $p
  $ledger = Invoke-NiptAdmin $p 'schema' -Quiet
  $filesRoot = if ($pc.PSObject.Properties['filesRoot'] -and $pc.filesRoot) { $pc.filesRoot } else { Join-Path $p.root 'data\files' }
  $listing = (@(Get-ChildItem -LiteralPath $filesRoot -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object { '{0}|{1}|{2}' -f $_.FullName.Substring($filesRoot.Length), $_.Length, $_.LastWriteTimeUtc.Ticks }) | Sort-Object) -join "`n"
  $oid = Invoke-NiptProcess -File (Join-Path $p.root 'runtime\pg\bin\psql.exe') -Arguments @('-h', '127.0.0.1', '-p', "$($pc.ports.postgres)", '-U', 'nipt_migrator', '-d', 'postgres', '-X', '-A', '-t', '-w', '-c', "SELECT oid FROM pg_database WHERE datname='$($pc.database)'") -Environment @{ PGPASSWORD = (& $secret $p 'db-password') } -Quiet
  $h = { param($t) $b = [Text.Encoding]::UTF8.GetBytes([string]$t); ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($b)) -replace '-', '').ToLower() }
  [ordered]@{ release = $ledger.release; ledger = (& $h (($ledger.ledger | ForEach-Object { "$($_.name)|$($_.checksum)" }) -join "`n")); databaseOid = $oid.StdOut.Trim()
    config = (Get-FileHash (Join-Path $p.root 'config\nipt.json')).Hash; installState = (Get-FileHash (Join-Path $p.root 'install-state.json')).Hash; fileStore = (& $h $listing) }
}
if ($IncludeReset) {
  if ($sIn -and $pIn) {
    Test-Result 'reset' 'staging-reset-leaves-production-unchanged' {
      $before = Get-ProductionFingerprint
      $resetArgs = @(); if ($ResetConfirmation) { $resetArgs = @('-Confirmation', $ResetConfirmation) }
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'reset-staging.ps1') @resetArgs
      if ($LASTEXITCODE -ne 0) { throw 'STAGING_RESET_FAILED (see history\staging)' }
      $after = Get-ProductionFingerprint
      $diff = @($before.Keys | Where-Object { [string]$before[$_] -ne [string]$after[$_] })
      if ($diff.Count) { throw "PRODUCTION_CHANGED_DURING_STAGING_RESET: $($diff -join ',')" }
      Add-Result 'reset' 'staging-reset-leaves-production-unchanged' 'PASS' (($before.Keys | ForEach-Object { "$_ unchanged" }) -join ', ')
    }
  } else { Add-Result 'reset' 'staging-reset-leaves-production-unchanged' 'NOT_RUN' "needs both environments installed (staging=$sIn production=$pIn)" }
}

Write-Host ''
foreach ($r in $results) { Write-Host ('{0,-8} {1,-11} {2,-48} {3}' -f $r.state, $r.area, $r.id, $r.detail) -ForegroundColor @{ PASS = 'Green'; FAIL = 'Red'; NOT_RUN = 'Yellow' }[$r.state] }
$fail = @($results | Where-Object state -eq 'FAIL').Count
$notRun = @($results | Where-Object state -eq 'NOT_RUN').Count
# a check that could not run (no firewall rule, no identity, an environment not installed) is a blocker, never a pass
$verdict = if ($fail) { 'FAIL' } elseif ($notRun) { 'INCOMPLETE' } else { 'PASS' }
$file = Join-Path (Join-Path (Join-Path $PSScriptRoot 'history') 'isolation') ((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '.json')
Write-NiptJson ([ordered]@{ checkedAt = (Get-Date).ToString('o'); host = $env:COMPUTERNAME; verdict = $verdict; failed = $fail; notRun = $notRun; results = @($results) }) $file
Write-Host ''
Write-Host ("ISOLATION {0}: {1} FAIL, {2} NOT_RUN (each NOT_RUN is an open security blocker)" -f $verdict, $fail, $notRun) -ForegroundColor @{ PASS = 'Green'; INCOMPLETE = 'Yellow'; FAIL = 'Red' }[$verdict]
Write-Host "evidence: $file"
exit $(switch ($verdict) { 'PASS' { 0 } 'FAIL' { 1 } default { 2 } })

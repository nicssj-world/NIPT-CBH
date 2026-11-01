<#
  NIPT-CBH Staging / Production direct deployment: shared orchestration for deploy-staging.ps1, deploy-production.ps1,
  rollback-production.ps1, health-check.ps1, preflight.ps1 and reset-staging.ps1. Windows PowerShell 5.1 compatible.

  - Decisions (environment separation, release IDs, Production gate, destructive SQL) live in deploy-gates.mjs and are unit-tested.
  - The release engine is the existing installer CLI (tools\win-installer\nipt-admin.mjs): install, upgrade (verified pre-upgrade backup,
    forward migrations, release switch, health, automatic rollback), rollback (schema-compatibility gate), status, health, schema.
  - Builds always come from a clean detached Git worktree at one exact commit, never from the developer's working copy.
  - Nothing here edits a release in place, deletes a database or touches another environment's root.
#>
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:DeployDir = $PSScriptRoot

# ───────────── paths, JSON, logging ─────────────
function Get-NiptDeployDir { $script:DeployDir }
function Get-NiptHistoryDir([string]$Environment) { Join-Path (Join-Path $script:DeployDir 'history') $Environment }
function Get-NiptVerifiedFile([string]$Commit) { Join-Path (Join-Path (Get-NiptHistoryDir 'staging') 'verified') ($Commit + '.json') }

function Read-NiptJson([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "FILE_MISSING: $Path" }
  (Get-Content -LiteralPath $Path -Raw -Encoding UTF8) -replace '^﻿', '' | ConvertFrom-Json
}
function Write-NiptJson($Value, [string]$Path) {
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $tmp = "$Path.$PID.tmp"
  [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $Value -Depth 30), (New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath $tmp -Destination $Path -Force
}
function Add-NiptJsonLine($Value, [string]$Path) {
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::AppendAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 30 -Compress) + "`n", (New-Object Text.UTF8Encoding $false))
}

$script:LogFile = $null
function Write-NiptLog([string]$Message, [ValidateSet('INFO', 'STEP', 'WARN', 'FAIL', 'OK')][string]$Level = 'INFO') {
  $line = '{0} [{1}] {2}' -f (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss.fffzzz'), $Level, $Message
  if ($script:LogFile) { [IO.File]::AppendAllText($script:LogFile, $line + "`r`n", (New-Object Text.UTF8Encoding $false)) }
  $colour = @{ INFO = 'Gray'; STEP = 'Cyan'; WARN = 'Yellow'; FAIL = 'Red'; OK = 'Green' }[$Level]
  Write-Host $line -ForegroundColor $colour
}

# ───────────── processes ─────────────
<# Windows command-line quoting (CommandLineToArgvW rules) for ProcessStartInfo.Arguments, which .NET Framework only accepts as one string. #>
function ConvertTo-NiptCommandLine([string[]]$Arguments) {
  $parts = foreach ($a in $Arguments) {
    if ($null -eq $a -or $a -eq '') { '""' }
    elseif ($a -notmatch '[\s"]') { $a }
    else { '"' + (($a -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"' }
  }
  $parts -join ' '
}

<# Runs a program with separated stdout/stderr (no PowerShell 5.1 NativeCommandError wrapping), optional extra environment, and logs both. #>
function Invoke-NiptProcess {
  param([Parameter(Mandatory)][string]$File, [string[]]$Arguments = @(), [string]$WorkingDirectory = $script:DeployDir,
    [hashtable]$Environment = @{}, [string]$Step = '', [switch]$Quiet)
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $File; $psi.Arguments = ConvertTo-NiptCommandLine $Arguments; $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  foreach ($k in $Environment.Keys) { $psi.EnvironmentVariables[$k] = [string]$Environment[$k] }
  if ($Step -and -not $Quiet) { Write-NiptLog "$Step" 'STEP' }
  $p = [Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEndAsync(); $err = $p.StandardError.ReadToEndAsync()
  $p.WaitForExit()
  $result = [pscustomobject]@{ ExitCode = $p.ExitCode; StdOut = $out.Result; StdErr = $err.Result }
  if ($script:LogFile -and -not $Quiet) {
    [IO.File]::AppendAllText($script:LogFile, "---- $Step exit=$($result.ExitCode)`r`n$($result.StdOut)`r`n$($result.StdErr)`r`n", (New-Object Text.UTF8Encoding $false))
  }
  $result
}

function Get-NiptLastJson([string]$Text) {
  # nipt-admin prints pretty JSON; deploy-gates and build-package print one JSON line last
  $t = $Text.Trim()
  if (-not $t) { return $null }
  try { return ($t | ConvertFrom-Json) } catch { }
  $last = ($t -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1)
  try { return ($last | ConvertFrom-Json) } catch { return $null }
}

# ───────────── configuration ─────────────
function Get-NiptToolchain {
  $t = Read-NiptJson (Join-Path $script:DeployDir 'toolchain.json')
  if ($t.format -ne 'NIPT_DEPLOY_TOOLCHAIN_V1') { throw 'TOOLCHAIN_FORMAT_INVALID' }
  $git = (Get-Command git.exe -ErrorAction SilentlyContinue)
  [pscustomobject]@{
    Node = Join-Path $t.nodeDir 'node.exe'; NodeDir = $t.nodeDir; Npm = Join-Path $t.nodeDir 'npm.cmd'
    Git = $(if ($git) { $git.Source } else { $null }); PostgresHome = $t.postgresHome; Powershell7Home = $t.powershell7Home
    PlaywrightBrowsers = $t.playwrightBrowsers; Source = $t.source; Builds = $t.builds
  }
}
function Get-NiptBuildEnvironment($Toolchain) {
  @{ Path = "$($Toolchain.NodeDir);$env:Path"; NIPT_PG_HOME = $Toolchain.PostgresHome; NIPT_PWSH_HOME = $Toolchain.Powershell7Home
    PLAYWRIGHT_BROWSERS_PATH = $Toolchain.PlaywrightBrowsers; NEXT_TELEMETRY_DISABLED = '1'; CI = '1' }
}

function Invoke-NiptGate([string]$Command, $Toolchain, $Data) {
  $file = Join-Path ([IO.Path]::GetTempPath()) ("nipt-gate-$PID-" + [guid]::NewGuid().ToString('N') + '.json')
  try {
    [IO.File]::WriteAllText($file, (ConvertTo-Json -InputObject $Data -Depth 30), (New-Object Text.UTF8Encoding $false))
    $r = Invoke-NiptProcess -File $Toolchain.Node -Arguments @((Join-Path $script:DeployDir 'deploy-gates.mjs'), $Command, $file) -Quiet
    $json = Get-NiptLastJson $r.StdOut
    if (-not $json) { throw "GATE_OUTPUT_UNREADABLE: $Command $($r.StdErr)" }
    $json
  } finally { Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue }
}

<# Both environment definitions, validated together: they must not share a root, instance, port, signing key or service account. #>
function Read-NiptEnvironments($Toolchain, [ValidateSet('staging', 'production')][string]$Purpose = 'staging') {
  $dir = Join-Path $script:DeployDir 'environments'
  $s = Read-NiptJson (Join-Path $dir 'staging.json'); $p = Read-NiptJson (Join-Path $dir 'production.json')
  # 'production' additionally requires the real bootstrap identities (no empty value, no placeholder)
  $check = Invoke-NiptGate 'environments' $Toolchain @{ staging = $s; production = $p; purpose = $Purpose }
  if (-not $check.ok) { throw "ENVIRONMENT_DEFINITION_INVALID: $($check.error)" }
  [pscustomobject]@{ staging = $s; production = $p }
}
function Get-NiptPublicKey($EnvCfg) {
  $leaf = (Split-Path -Leaf $EnvCfg.signingKey) -replace 'private', 'public'
  Join-Path (Split-Path -Parent $EnvCfg.signingKey) $leaf
}
function Test-NiptInstalled($EnvCfg) { Test-Path -LiteralPath (Join-Path $EnvCfg.root 'install-state.json') -PathType Leaf }
<# The Windows account the environment's Worker runs as: its dedicated identity once provision-identities.ps1 has run, otherwise the installing user. #>
function Get-NiptWorkerAccount($EnvCfg) {
  $marker = Join-Path $EnvCfg.root 'config\service-identity.json'
  if (Test-Path -LiteralPath $marker) { return (Read-NiptJson $marker).account }
  "$env:COMPUTERNAME\$env:USERNAME".ToLowerInvariant()
}
function Test-NiptElevated { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }
<# Services under a dedicated identity are another user's processes: only an elevated prompt can verify them (the engine's supervisor check
   reads their command line). Refuse up front, before an upgrade could fail its health check and roll itself back for that reason alone. #>
function Assert-NiptCanVerifyServices($EnvCfg) {
  if ((Test-Path -LiteralPath (Join-Path $EnvCfg.root 'config\service-identity.json')) -and -not (Test-NiptElevated)) {
    throw "ELEVATED_PROMPT_REQUIRED: $($EnvCfg.environment) runs under its dedicated service identity; run this from an elevated PowerShell"
  }
}
function Get-NiptJourneyEnvironment($Toolchain, $EnvCfg) {
  $e = Get-NiptBuildEnvironment $Toolchain
  $e.NIPT_WORKER_SERVICE_ACCOUNT = Get-NiptWorkerAccount $EnvCfg
  $e
}

# ───────────── single deployment at a time, history ─────────────
function Enter-NiptDeployLock {
  $path = Join-Path (Join-Path $script:DeployDir 'history') 'deploy.lock'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
  try { $stream = [IO.File]::Open($path, 'OpenOrCreate', 'ReadWrite', 'None') } catch { throw 'DEPLOYMENT_ALREADY_RUNNING: another deployment, rollback or reset holds history\deploy.lock' }
  $bytes = [Text.Encoding]::ASCII.GetBytes("pid=$PID user=$env:USERNAME at=$((Get-Date).ToString('o'))")
  $stream.SetLength(0); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush()
  $stream
}

function Start-NiptRun([string]$Environment, [string]$Action) {
  $id = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + $Action
  $dir = Join-Path (Get-NiptHistoryDir $Environment) $id
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $script:LogFile = Join-Path $dir 'run.log'
  Write-NiptLog "NIPT-CBH $Action ($Environment) run $id by $env:USERDOMAIN\$env:USERNAME on $env:COMPUTERNAME"
  [ordered]@{ format = 'NIPT_DEPLOY_RUN_V1'; runId = $id; environment = $Environment; action = $Action; operator = "$env:USERDOMAIN\$env:USERNAME"
    host = $env:COMPUTERNAME; startedAt = (Get-Date).ToString('o'); outcome = 'RUNNING'; directory = $dir }
}
function Complete-NiptRun($Run, [string]$Outcome, $Detail) {
  $Run.outcome = $Outcome; $Run.finishedAt = (Get-Date).ToString('o')
  if ($null -ne $Detail) { foreach ($k in $Detail.Keys) { $Run[$k] = $Detail[$k] } }
  Write-NiptJson $Run (Join-Path $Run.directory 'record.json')
  Add-NiptJsonLine $Run (Join-Path (Get-NiptHistoryDir $Run.environment) 'deployments.jsonl')
  Write-NiptLog "$($Run.action) $Outcome -> $(Join-Path $Run.directory 'record.json')" $(if ($Outcome -eq 'SUCCEEDED') { 'OK' } else { 'FAIL' })
}

# ───────────── source and build ─────────────
function Invoke-NiptGit($Toolchain, [string]$Repo, [string[]]$Arguments) {
  if (-not $Toolchain.Git) { throw 'GIT_NOT_FOUND' }
  $r = Invoke-NiptProcess -File $Toolchain.Git -Arguments (@('-C', $Repo) + $Arguments) -Quiet
  if ($r.ExitCode -ne 0) { throw "GIT_FAILED: git $($Arguments -join ' '): $($r.StdErr.Trim())" }
  $r.StdOut.Trim()
}
function Resolve-NiptCommit($Toolchain, [string]$Ref) {
  $sha = Invoke-NiptGit $Toolchain $Toolchain.Source @('rev-parse', '--verify', '--end-of-options', "$Ref^{commit}")
  if ($sha -notmatch '^[0-9a-f]{40}$') { throw "COMMIT_UNRESOLVED: $Ref" }
  $sha
}
<# The application version a commit declares (deploy\windows\app-version.json at that commit), unless the operator states it. #>
function Resolve-NiptAppVersion($Toolchain, [string]$Commit, [string]$Override) {
  if ($Override) { return $Override }
  try { $raw = Invoke-NiptGit $Toolchain $Toolchain.Source @('show', "${Commit}:deploy/windows/app-version.json") }
  catch { throw 'APP_VERSION_UNKNOWN: the commit has no deploy/windows/app-version.json; pass -AppVersion x.y.z explicitly' }
  ($raw | ConvertFrom-Json).appVersion
}
<# Clean detached worktree at exactly $Commit (short folder name: Windows path length). Reused only if still clean and on that commit. #>
function Get-NiptBuildWorktree($Toolchain, [string]$Commit) {
  $wt = Join-Path $Toolchain.Builds $Commit.Substring(0, 12)
  if (Test-Path -LiteralPath (Join-Path $wt '.git')) {
    if ((Invoke-NiptGit $Toolchain $wt @('rev-parse', 'HEAD')) -ne $Commit) { throw "BUILD_WORKTREE_HEAD_MISMATCH: $wt" }
    if (Invoke-NiptGit $Toolchain $wt @('status', '--porcelain', '--untracked-files=normal')) { throw "BUILD_WORKTREE_NOT_CLEAN: $wt" }
    Write-NiptLog "reusing clean build worktree $wt"
    return $wt
  }
  if (Test-Path -LiteralPath $wt) { throw "BUILD_WORKTREE_PATH_OCCUPIED: $wt" }
  New-Item -ItemType Directory -Force -Path $Toolchain.Builds | Out-Null
  Invoke-NiptGit $Toolchain $Toolchain.Source @('worktree', 'add', '--detach', $wt, $Commit) | Out-Null
  Write-NiptLog "created build worktree $wt at $Commit"
  $wt
}

$script:ValidationSteps = [ordered]@{
  typecheck          = @('run', 'typecheck')
  lint               = @('run', 'lint')
  'test:unit'        = @('run', 'test:unit')
  guard              = @('run', 'guard')
}
<# Reproducible dependencies (npm ci from the lockfile) and the source checks. Returns one result per step; throws on the first failure. #>
function Invoke-NiptValidation($Toolchain, [string]$Worktree, [ValidateSet('full', 'quick')][string]$Level) {
  $envs = Get-NiptBuildEnvironment $Toolchain
  function Step([string]$Name, [string]$File, [string[]]$Arguments) {
    $t = Get-Date
    $r = Invoke-NiptProcess -File $File -Arguments $Arguments -WorkingDirectory $Worktree -Environment $envs -Step "validation: $Name"
    if ($r.ExitCode -ne 0) { throw "VALIDATION_FAILED: $Name (exit $($r.ExitCode)); see run.log" }
    [pscustomobject]@{ step = $Name; exitCode = $r.ExitCode; seconds = [math]::Round(((Get-Date) - $t).TotalSeconds, 1) }
  }
  $results = @()
  $results += Step 'npm ci' $env:ComSpec @('/d', '/c', $Toolchain.Npm, 'ci', '--no-audit', '--no-fund')
  $deployTests = @(Get-ChildItem -LiteralPath (Join-Path $Worktree 'tests\deploy') -Filter '*.node.mjs' | ForEach-Object { 'tests/deploy/' + $_.Name })
  $results += Step 'deploy contracts' $Toolchain.Node (@('--test') + $deployTests)
  if ($Level -eq 'full') {
    foreach ($name in $script:ValidationSteps.Keys) { $results += Step $name $env:ComSpec (@('/d', '/c', $Toolchain.Npm) + $script:ValidationSteps[$name]) }
  }
  $results
}

<# The approved clinical inputs, against the SHA-256 that the commit being deployed pins (its own master-manifest.json and form-assets.mjs).
   Checked before any dependency install or build, so a missing or different file stops the deployment at once, by name. #>
function Assert-NiptAssets([string]$Worktree, $EnvCfg) {
  $master = (Get-Content -LiteralPath (Join-Path $Worktree 'packages\workbook\master-manifest.json') -Raw | ConvertFrom-Json).sha256
  $forms = Get-Content -LiteralPath (Join-Path $Worktree 'tools\win-installer\form-assets.mjs') -Raw
  $wanted = @(
    @{ code = 'MASTER_WORKBOOK'; file = $EnvCfg.masterWorkbook; sha = $master },
    @{ code = 'ANC_REQUEST_PDF'; file = $EnvCfg.ancRequestPdf; sha = [regex]::Match($forms, "\brequest\s*:\s*'([a-f0-9]{64})'").Groups[1].Value },
    @{ code = 'ANC_CONSENT_PDF'; file = $EnvCfg.ancConsentPdf; sha = [regex]::Match($forms, "\bconsent\s*:\s*'([a-f0-9]{64})'").Groups[1].Value })
  $problems = @(foreach ($w in $wanted) {
      if ($w.sha -notmatch '^[a-f0-9]{64}$') { "$($w.code)_PIN_UNREADABLE"; continue }
      if (-not (Test-Path -LiteralPath $w.file -PathType Leaf)) { "$($w.code)_MISSING: $($w.file) (pinned sha256 $($w.sha))"; continue }
      $h = (Get-FileHash -LiteralPath $w.file -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($h -ne $w.sha) { "$($w.code)_SHA256_MISMATCH: $($w.file) is $h, pinned $($w.sha)" } else { Write-NiptLog "asset $($w.code) matches the pinned SHA-256" 'OK' } })
  if ($problems.Count) { throw "APPROVED_ASSETS_NOT_READY: $($problems -join ' | ')" }
}

<# The signed Windows package for one environment, built by the repository's own tools\win-installer\build-package.ts. #>
function New-NiptPackage($Toolchain, [string]$Worktree, [string]$ReleaseId, $EnvCfg, [switch]$AppOnly, [switch]$SkipBuild) {
  $out = Join-Path $Worktree ".local\p8-win\packages\$ReleaseId-$($EnvCfg.profile)"
  $a = @('--import', 'tsx', 'tools/win-installer/build-package.ts', '--version', $ReleaseId, '--profile', $EnvCfg.profile, '--out', $out,
    '--signing-key', $EnvCfg.signingKey, '--anc-request-pdf', $EnvCfg.ancRequestPdf, '--anc-consent-pdf', $EnvCfg.ancConsentPdf, '--master-workbook', $EnvCfg.masterWorkbook)
  if ($AppOnly) { $a += '--app-only' }
  if ($SkipBuild) { $a += '--skip-build' }
  $r = Invoke-NiptProcess -File $Toolchain.Node -Arguments $a -WorkingDirectory $Worktree -Environment (Get-NiptBuildEnvironment $Toolchain) -Step "package: $($EnvCfg.profile) $ReleaseId$(if($AppOnly){' (app only)'})"
  if ($r.ExitCode -ne 0) { throw "PACKAGE_BUILD_FAILED: $(($r.StdErr -split "`n" | Select-Object -Last 3) -join ' ')" }
  $built = Get-NiptLastJson $r.StdOut
  if (-not $built -or -not (Test-Path -LiteralPath (Join-Path $out 'manifest.json'))) { throw 'PACKAGE_OUTPUT_MISSING' }
  $facts = Invoke-NiptGate 'package-facts' $Toolchain @{ dir = $out }
  if (-not $facts.ok) { throw "PACKAGE_FACTS_FAILED: $($facts.error)" }
  Add-Member -InputObject $facts -NotePropertyName dir -NotePropertyValue $out -Force
  $facts
}

<# An Ed25519 package-signing key pair per environment; the private key is readable by the deploying administrator, SYSTEM and Administrators only. #>
function Initialize-NiptSigningKey($Toolchain, $EnvCfg) {
  $private = $EnvCfg.signingKey; $public = Get-NiptPublicKey $EnvCfg
  if (Test-Path -LiteralPath $private) { return $public }
  $dir = Split-Path -Parent $private
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  & icacls.exe $dir /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
  $js = "const c=require('node:crypto'),f=require('node:fs');const k=c.generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});f.writeFileSync(process.argv[1],k.privateKey,{flag:'wx'});f.writeFileSync(process.argv[2],k.publicKey,{flag:'wx'});"
  $r = Invoke-NiptProcess -File $Toolchain.Node -Arguments @('-e', $js, $private, $public) -Step "signing key ($($EnvCfg.environment))"
  if ($r.ExitCode -ne 0) { throw "SIGNING_KEY_CREATION_FAILED: $($r.StdErr)" }
  $public
}

# ───────────── engine (nipt-admin) ─────────────
<# The installed engine of an environment (its own runtime\node and admin\nipt-admin.mjs), or a package's engine for a first install. #>
function Invoke-NiptAdmin {
  param([Parameter(Mandatory)]$EnvCfg, [Parameter(Mandatory)][string]$Command, [string[]]$Arguments = @(), [string]$Node, [string]$Cli, [string]$WorkingDirectory, [switch]$Quiet)
  if (-not $Node) { $Node = Join-Path $EnvCfg.root 'runtime\node\node.exe' }
  if (-not $Cli) { $Cli = Join-Path $EnvCfg.root 'admin\nipt-admin.mjs' }
  if (-not $WorkingDirectory) { $WorkingDirectory = $EnvCfg.root }
  foreach ($f in @($Node, $Cli)) { if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { throw "ENGINE_MISSING: $f" } }
  $r = Invoke-NiptProcess -File $Node -Arguments (@($Cli, $Command) + $Arguments + @('--root', $EnvCfg.root)) -WorkingDirectory $WorkingDirectory -Step "engine: $Command ($($EnvCfg.environment))" -Quiet:$Quiet
  $json = Get-NiptLastJson $r.StdOut
  if (-not $json) { $json = [pscustomobject]@{ ok = $false; error = 'ENGINE_OUTPUT_UNREADABLE'; detail = ($r.StdErr -split "`n" | Select-Object -Last 5) -join ' ' } }
  Add-Member -InputObject $json -NotePropertyName exitCode -NotePropertyValue $r.ExitCode -Force
  $json
}
function Assert-NiptEngineOk($Result, [string]$What) {
  if ($Result.exitCode -ne 0 -or ($Result.PSObject.Properties['ok'] -and $Result.ok -eq $false)) {
    $detail = if ($Result.PSObject.Properties['detail']) { ConvertTo-Json -InputObject $Result.detail -Depth 8 -Compress } else { '' }
    throw "$($What)_FAILED: $($Result.error) $detail"
  }
}

<# Install arguments for the first deployment of an environment (the engine refuses a non-empty root, so this can never overwrite one). #>
function Get-NiptInstallArguments($EnvCfg, $OtherCfg, [string]$Package, [string]$PublicKey) {
  $p = $EnvCfg.ports
  $a = @('--package', $Package, '--public-key', $PublicKey, '--profile', $EnvCfg.profile, '--master-workbook', $EnvCfg.masterWorkbook,
    '--task-mode', $EnvCfg.taskMode, '--excel-mode', $EnvCfg.excelMode, '--instance', $EnvCfg.instance,
    '--ports', "$($p.postgres),$($p.web),$($p.https),$($p.renderer)", '--environment', $EnvCfg.environment, '--protected-roots', $OtherCfg.root)
  if ($EnvCfg.lan.enabled) {
    $a += @('--lan', 'yes', '--host', $EnvCfg.lan.host)
    if ($EnvCfg.lan.PSObject.Properties['allow'] -and $EnvCfg.lan.allow) { $a += @('--lan-allow', $EnvCfg.lan.allow) }
    # bind HTTPS to one adapter (e.g. the hospital Ethernet address) so a Wi-Fi or hotspot address never serves clients
    if ($EnvCfg.lan.PSObject.Properties['listen'] -and $EnvCfg.lan.listen) { $a += @('--https-host', $EnvCfg.lan.listen) }
    if ($EnvCfg.lan.PSObject.Properties['profiles'] -and $EnvCfg.lan.profiles) { $a += @('--lan-profiles', $EnvCfg.lan.profiles) }
  }
  if ($EnvCfg.environment -eq 'production') {
    $b = $EnvCfg.bootstrap
    # one first account (APP_ADMIN); other users, including report personnel, are created in user management
    $a += @('--admin-user', $b.adminUser, '--admin-name', $b.adminName)
  }
  $a
}

<# Status + health + schema of one environment, and the boundary facts the deployment relies on. #>
function Get-NiptEnvironmentReport($EnvCfg, [switch]$Quiet) {
  if (-not (Test-NiptInstalled $EnvCfg)) { return [pscustomobject]@{ environment = $EnvCfg.environment; installed = $false; ok = $false; failed = @('NOT_INSTALLED') } }
  $status = Invoke-NiptAdmin $EnvCfg 'status' -Quiet:$Quiet
  $health = Invoke-NiptAdmin $EnvCfg 'health' -Quiet:$Quiet
  $schema = Invoke-NiptAdmin $EnvCfg 'schema' -Quiet:$Quiet
  $stampFile = Join-Path $EnvCfg.root 'environment.json'
  $stamp = if (Test-Path -LiteralPath $stampFile) { Read-NiptJson $stampFile } else { $null }
  $failed = @()
  if (-not ($health.PSObject.Properties['ok'] -and $health.ok)) { $failed += 'HEALTH' }
  if (-not ($schema.PSObject.Properties['ok'] -and $schema.ok)) { $failed += 'SCHEMA' }
  if (-not $stamp -or $stamp.environment -ne $EnvCfg.environment) { $failed += 'ENVIRONMENT_STAMP' }
  if (-not ($status.PSObject.Properties['environment'] -and $status.environment -eq $EnvCfg.environment)) { $failed += 'ENVIRONMENT_CONFIG' }
  if (-not ($status.PSObject.Properties['databaseMarkerOk'] -and $status.databaseMarkerOk)) { $failed += 'DATABASE_MARKER' }
  [pscustomobject]@{ environment = $EnvCfg.environment; installed = $true; ok = ($failed.Count -eq 0); failed = $failed; status = $status; health = $health; schema = $schema; stamp = $stamp }
}

# ───────────── on-demand Staging lifecycle ─────────────
<# The operator's intent for Staging (STOPPED / RUNNING), kept outside the engine root so an intentional stop is never an incident. #>
function Get-NiptLifecycleFile { Join-Path (Get-NiptHistoryDir 'staging') 'lifecycle.json' }
function Get-NiptStagingIntent {
  $f = Get-NiptLifecycleFile
  if (Test-Path -LiteralPath $f) { return Read-NiptJson $f }
  [pscustomobject]@{ state = 'UNKNOWN'; at = $null; by = $null }
}
function Set-NiptStagingIntent([ValidateSet('RUNNING', 'STOPPED')][string]$State, [string]$Reason) {
  $v = [ordered]@{ format = 'NIPT_STAGING_LIFECYCLE_V1'; state = $State; at = (Get-Date).ToString('o'); by = "$env:USERDOMAIN\$env:USERNAME"; reason = $Reason }
  Write-NiptJson $v (Get-NiptLifecycleFile)
  Add-NiptJsonLine $v (Join-Path (Get-NiptHistoryDir 'staging') 'lifecycle.jsonl')
}

<# Windows memory, measured: physical and commit (RAM + pagefile). Commit is what ran out when Staging's PostgreSQL was killed (0xC000012D). #>
function Get-NiptMemory {
  $os = Get-CimInstance Win32_OperatingSystem
  $limit = $os.TotalVirtualMemorySize * 1KB; $free = $os.FreeVirtualMemory * 1KB
  [pscustomobject]@{ physicalTotalGB = [math]::Round($os.TotalVisibleMemorySize * 1KB / 1GB, 2); physicalFreeGB = [math]::Round($os.FreePhysicalMemory * 1KB / 1GB, 2)
    commitLimitGB = [math]::Round($limit / 1GB, 2); commitUsedGB = [math]::Round(($limit - $free) / 1GB, 2); commitFreeGB = [math]::Round($free / 1GB, 2)
    pagefileMB = [int](@(Get-CimInstance Win32_PageFileUsage | ForEach-Object AllocatedBaseSize) | Measure-Object -Sum).Sum }
}

<# Processes that belong to one environment: started from its own runtime folder (node, postgres, pwsh of the bridge). Never anything else. #>
function Get-NiptOwnedProcesses($EnvCfg) {
  $runtime = (Join-Path $EnvCfg.root 'runtime').ToLowerInvariant() + '\'
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant().StartsWith($runtime) } | ForEach-Object {
      $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
      [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; privateMB = $(if ($p) { [int]($p.PrivateMemorySize64 / 1MB) } else { 0 }) } })
}

function Get-NiptTaskNames($EnvCfg) { [pscustomobject]@{ supervisor = "nipt-cbh-$($EnvCfg.instance)"; bridge = "nipt-cbh-$($EnvCfg.instance)-excel-bridge" } }
function Get-NiptBridgeState($EnvCfg) {
  $f = Join-Path $EnvCfg.root 'data\excel-spool\bridge-status.json'
  try { $s = Read-NiptJson $f; $age = ((Get-Date).ToUniversalTime() - [datetime]::Parse($s.updatedAt).ToUniversalTime()).TotalSeconds
    [pscustomobject]@{ state = $s.state; pid = $s.pid; ageSeconds = [int]$age; alive = (($s.state -eq 'idle' -and $age -lt 10) -or ($s.state -eq 'processing' -and $age -lt 240)) } }
  catch { [pscustomobject]@{ state = 'NOT_RUNNING'; pid = $null; ageSeconds = $null; alive = $false } }
}

<# Jobs the Staging queue still holds (read-only; PostgreSQL must be running). #>
function Get-NiptQueueBacklog($EnvCfg) {
  $cfg = Read-NiptJson (Join-Path $EnvCfg.root 'config\nipt.json')
  $sql = "SELECT state||'|'||count(*) FROM pgboss.job WHERE state IN ('created','retry','active') GROUP BY state"
  $r = Invoke-NiptProcess -File (Join-Path $EnvCfg.root 'runtime\pg\bin\psql.exe') -Arguments @('-h', '127.0.0.1', '-p', "$($cfg.ports.postgres)", '-U', 'nipt_migrator', '-d', $cfg.database, '-X', '-A', '-t', '-w', '-c', $sql) -Environment @{ PGPASSWORD = (Get-Content -LiteralPath (Join-Path $EnvCfg.root 'secrets\db-password') -Raw).Trim(); PGCONNECT_TIMEOUT = '5' } -Quiet
  if ($r.ExitCode -ne 0) { return $null }
  $o = [ordered]@{ created = 0; retry = 0; active = 0 }
  foreach ($line in ($r.StdOut -split "`r?`n" | Where-Object { $_ })) { $k, $n = $line.Split('|'); $o[$k] = [int]$n }
  [pscustomobject]$o
}

<# Isolation layers that only an elevated provisioning creates: dedicated identity and the Staging egress block. #>
function Get-NiptIsolationReadiness($EnvCfg) {
  $identity = Test-Path -LiteralPath (Join-Path $EnvCfg.root 'config\service-identity.json')
  $rules = @(Get-NetFirewallRule -DisplayName 'NIPT-CBH Staging egress block*' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Block' -and $_.Direction -eq 'Outbound' })
  $missing = @(); if (-not $identity) { $missing += 'SERVICE_IDENTITY' }; if (-not $rules.Count) { $missing += 'EGRESS_FIREWALL_RULE' }
  [pscustomobject]@{ ready = ($missing.Count -eq 0); missing = $missing; egressRules = $rules.Count; serviceIdentity = $identity }
}

<# On-demand Staging: an operation that needs the running services refuses on a stopped Staging instead of silently starting it. #>
function Assert-NiptStagingStarted($EnvCfg) {
  if ((Test-NiptInstalled $EnvCfg) -and -not @(Get-NiptOwnedProcesses $EnvCfg).Count) { throw 'STAGING_STOPPED: start it first with .\deploy\start-staging.ps1 (on-demand Staging is never started implicitly)' }
}

Export-ModuleMember -Function *-Nipt*

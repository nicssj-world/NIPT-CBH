<#
.SYNOPSIS  Read-only readiness check of this host for Staging and Production deployment. Lists every blocker; changes nothing.
.DESCRIPTION
  PASS / WARN / BLOCKED for: deployment definitions, toolchain (Node 24 + npm, Git, PostgreSQL 17 binaries, PowerShell 7, Chromium
  headless shell), approved clinical assets against the repository-pinned SHA-256, signing keys, environment roots and ports,
  disk space, Office, service identities, listeners and repository visibility. Exit code 1 when anything is BLOCKED.
.EXAMPLE   .\deploy\preflight.ps1
.EXAMPLE   .\deploy\preflight.ps1 -Environment production -Json C:\NIPT-CBH\deploy\history\preflight.json
#>
[CmdletBinding()]
param(
  [ValidateSet('staging', 'production', 'all')][string]$Environment = 'all',
  [string]$Json,
  [switch]$SkipNetwork
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'NiptDeploy.psm1') -Force -DisableNameChecking

$checks = New-Object System.Collections.ArrayList
function Add-Check([string]$Area, [string]$Id, [ValidateSet('PASS', 'WARN', 'BLOCKED')][string]$State, [string]$Detail = '') {
  [void]$checks.Add([pscustomobject]@{ area = $Area; id = $Id; state = $State; detail = $Detail })
}
function Test-Check([string]$Area, [string]$Id, [scriptblock]$Body) {
  try { & $Body } catch { Add-Check $Area $Id 'BLOCKED' $_.Exception.Message }
}
$sha = { param($f) (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant() }

$tc = $null; $envs = $null
Test-Check 'definitions' 'toolchain.json' { $script:tc = Get-NiptToolchain; Add-Check 'definitions' 'toolchain.json' 'PASS' }
$tc = $script:tc
if ($tc) {
  Test-Check 'toolchain' 'node24' {
    if (-not (Test-Path -LiteralPath $tc.Node)) { throw "NODE_NOT_FOUND: $($tc.Node) (install the Node.js 24 Windows zip there)" }
    $v = (& $tc.Node -v).Trim()
    if ($v -notmatch '^v24\.') { throw "NODE_24_REQUIRED: found $v" }
    if ($tc.NodeDir -match '\s') { throw 'NODE_DIR_MUST_NOT_CONTAIN_SPACES' }
    Add-Check 'toolchain' 'node24' 'PASS' $v
  }
  Test-Check 'toolchain' 'npm' { if (-not (Test-Path -LiteralPath $tc.Npm)) { throw "NPM_NOT_FOUND: $($tc.Npm)" }; Add-Check 'toolchain' 'npm' 'PASS' }
  Test-Check 'toolchain' 'git' { if (-not $tc.Git) { throw 'GIT_NOT_ON_PATH' }; Add-Check 'toolchain' 'git' 'PASS' ((& $tc.Git --version) -join '') }
  Test-Check 'toolchain' 'postgresql17' {
    $pg = Join-Path $tc.PostgresHome 'bin\postgres.exe'
    if (-not (Test-Path -LiteralPath $pg)) { throw "POSTGRES_BINARIES_NOT_FOUND: $($tc.PostgresHome)" }
    $v = (& $pg --version) -join ''; if ($v -notmatch ' 17\.') { throw "POSTGRES_17_REQUIRED: $v" }
    Add-Check 'toolchain' 'postgresql17' 'PASS' $v
  }
  Test-Check 'toolchain' 'powershell7' { if (-not (Test-Path -LiteralPath (Join-Path $tc.Powershell7Home 'pwsh.exe'))) { throw "POWERSHELL7_NOT_FOUND: $($tc.Powershell7Home) (the native Excel export needs it)" }; Add-Check 'toolchain' 'powershell7' 'PASS' }
  Test-Check 'toolchain' 'chromium' {
    $shell = @(Get-ChildItem -LiteralPath $tc.PlaywrightBrowsers -Directory -Filter 'chromium_headless_shell-*' -ErrorAction SilentlyContinue)
    if (-not $shell.Count) { throw "CHROMIUM_HEADLESS_SHELL_NOT_FOUND: $($tc.PlaywrightBrowsers) (npx playwright install chromium, with PLAYWRIGHT_BROWSERS_PATH set)" }
    Add-Check 'toolchain' 'chromium' 'PASS' ($shell.Name -join ',')
  }
  Test-Check 'source' 'repository' {
    if (-not (Test-Path -LiteralPath (Join-Path $tc.Source '.git'))) { throw "SOURCE_CHECKOUT_NOT_FOUND: $($tc.Source)" }
    $origin = Invoke-NiptGit $tc $tc.Source @('remote', 'get-url', 'origin')
    $head = Invoke-NiptGit $tc $tc.Source @('rev-parse', 'HEAD')
    $dirty = Invoke-NiptGit $tc $tc.Source @('status', '--porcelain', '--untracked-files=normal')
    Add-Check 'source' 'repository' $(if ($dirty) { 'WARN' } else { 'PASS' }) "$origin HEAD $head$(if($dirty){' (uncommitted changes: never deployed)'})"
  }
  Test-Check 'definitions' 'environments' { $script:envs = Read-NiptEnvironments $tc; Add-Check 'definitions' 'environments' 'PASS' 'staging and production share no root, instance, port, key or account' }
  $envs = $script:envs
}

if ($envs -and $tc) {
  $names = if ($Environment -eq 'all') { @('staging', 'production') } else { @($Environment) }
  # assets: the same approved files serve both environments; hashes are pinned in the source checkout
  Test-Check 'assets' 'master-workbook' {
    $pinned = (Get-Content -LiteralPath (Join-Path $tc.Source 'packages\workbook\master-manifest.json') -Raw | ConvertFrom-Json).sha256
    $f = $envs.staging.masterWorkbook
    if (-not (Test-Path -LiteralPath $f)) { throw "MASTER_WORKBOOK_MISSING: $f (Combined Excel Master from NIPT-CBH-HOME-BACKUP; pinned sha256 $pinned)" }
    $h = & $sha $f; if ($h -ne $pinned) { throw "MASTER_WORKBOOK_SHA256_MISMATCH: $h, pinned $pinned" }
    Add-Check 'assets' 'master-workbook' 'PASS' $h
  }
  Test-Check 'assets' 'anc-forms' {
    $text = Get-Content -LiteralPath (Join-Path $tc.Source 'tools\win-installer\form-assets.mjs') -Raw
    foreach ($kind in 'request', 'consent') {
      $pinned = [regex]::Match($text, "\b$kind\s*:\s*'([a-f0-9]{64})'").Groups[1].Value
      $f = $envs.staging.$('anc' + (Get-Culture).TextInfo.ToTitleCase($kind) + 'Pdf')
      $code = 'ANC_' + $kind.ToUpper() + '_PDF'
      if (-not (Test-Path -LiteralPath $f)) { throw "${code}_MISSING: $f (pinned sha256 $pinned)" }
      $h = & $sha $f; if ($h -ne $pinned) { throw "${code}_SHA256_MISMATCH: $h, pinned $pinned" }
    }
    Add-Check 'assets' 'anc-forms' 'PASS' 'request + consent match the pinned SHA-256'
  }
  foreach ($n in $names) {
    $cfg = $envs.$n
    Test-Check $n 'signing-key' {
      if (Test-Path -LiteralPath $cfg.signingKey) { Add-Check $n 'signing-key' 'PASS' $cfg.signingKey } else { Add-Check $n 'signing-key' 'WARN' "created on the first deployment: $($cfg.signingKey)" }
    }
    Test-Check $n 'root' {
      if (Test-NiptInstalled $cfg) { Add-Check $n 'root' 'PASS' "installed: $($cfg.root)" }
      elseif (-not (Test-Path -LiteralPath $cfg.root) -or -not @(Get-ChildItem -LiteralPath $cfg.root -Force).Count) { Add-Check $n 'root' 'PASS' "empty, first deployment installs here: $($cfg.root)" }
      else { throw "ROOT_NOT_EMPTY_AND_NOT_INSTALLED: $($cfg.root) (inventory it; the engine never installs over existing files)" }
    }
    Test-Check $n 'ports' {
      if (Test-NiptInstalled $cfg) { Add-Check $n 'ports' 'PASS' 'owned by the installed environment'; return }
      $busy = @(foreach ($k in 'postgres', 'web', 'https', 'renderer') { $p = $cfg.ports.$k; if (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) { "$k=$p" } })
      if ($busy.Count) { throw "PORTS_IN_USE: $($busy -join ', ')" }
      Add-Check $n 'ports' 'PASS' (($cfg.ports.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ', ')
    }
    Test-Check $n 'disk' {
      $drive = (Split-Path -Qualifier $cfg.root).TrimEnd(':')
      $free = (Get-PSDrive -Name $drive).Free
      if ($free -lt 16GB) { throw "FREE_SPACE_BELOW_16GB: $([math]::Round($free/1GB,1)) GB on ${drive}:" }
      Add-Check $n 'disk' 'PASS' "$([math]::Round($free/1GB,1)) GB free on ${drive}:"
    }
    Test-Check $n 'service-account' {
      if (-not $cfg.serviceAccount) { Add-Check $n 'service-account' 'WARN' 'no dedicated identity configured: services run as the installing user'; return }
      $u = Get-LocalUser -Name $cfg.serviceAccount -ErrorAction SilentlyContinue
      if ($u) { Add-Check $n 'service-account' 'PASS' "$($cfg.serviceAccount) exists" } else { Add-Check $n 'service-account' 'WARN' "$($cfg.serviceAccount) not created yet: run provision-identities.ps1 (elevated) after the first deployment" }
    }
    if ($n -eq 'production') {
      Test-Check $n 'bootstrap-identities' {
        $b = $cfg.bootstrap
        if ($b.adminUser -like 'replace*' -or $b.checkerUser -like 'replace*' -or $b.adminName -like 'Replace*' -or $b.checkerName -like 'Replace*') { throw 'PRODUCTION_BOOTSTRAP_PLACEHOLDERS: set the real APP_ADMIN and CLINICAL_APPROVER usernames/names in environments\production.json' }
        Add-Check $n 'bootstrap-identities' 'PASS' "$($b.adminUser) / $($b.checkerUser)"
      }
      Test-Check $n 'tls' { Add-Check $n 'tls' 'WARN' 'the engine generates a self-signed certificate; trusted hospital TLS needs a certificate from hospital IT (see README-DEPLOYMENT.md)' }
      Test-Check $n 'dns' {
        $h = $cfg.lan.host
        try { $a = @([Net.Dns]::GetHostAddresses($h) | ForEach-Object { $_.IPAddressToString }); Add-Check $n 'dns' 'PASS' "$h -> $($a -join ',')" }
        catch { Add-Check $n 'dns' 'WARN' "$h does not resolve on this host yet (hospital DNS entry required for https://$h)" }
      }
    }
  }
}

Test-Check 'host' 'office' {
  $word = Test-Path 'Registry::HKEY_CLASSES_ROOT\Word.Application\CurVer'; $excel = Test-Path 'Registry::HKEY_CLASSES_ROOT\Excel.Application\CurVer'
  if (-not ($word -and $excel)) { throw "OFFICE_REQUIRED: Word=$word Excel=$excel" }
  Add-Check 'host' 'office' 'PASS' ((Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\Excel.Application\CurVer').'(default)')
}
Test-Check 'host' 'elevation' {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  Add-Check 'host' 'elevation' $(if ($admin) { 'PASS' } else { 'WARN' }) $(if ($admin) { 'elevated' } else { 'not elevated: deployments run, but firewall rules, certificate trust and provision-identities.ps1 need an elevated prompt' })
}
Test-Check 'host' 'other-postgresql-listeners' {
  $wide = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in '0.0.0.0', '::' } | Where-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name -eq 'postgres' } | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" } | Sort-Object -Unique)
  if ($wide.Count) { Add-Check 'host' 'other-postgresql-listeners' 'WARN' "a PostgreSQL outside NIPT-CBH listens on all interfaces: $($wide -join ', ') (NIPT clusters listen on 127.0.0.1 only; restrict or retire this one with IT)" }
  else { Add-Check 'host' 'other-postgresql-listeners' 'PASS' 'no PostgreSQL listens beyond loopback' }
}
if (-not $SkipNetwork -and $tc) {
  Test-Check 'security' 'repository-visibility' {
    $origin = Invoke-NiptGit $tc $tc.Source @('remote', 'get-url', 'origin')
    $m = [regex]::Match($origin, 'github\.com[:/](?<o>[^/]+)/(?<r>[^/.]+)')
    if (-not $m.Success) { Add-Check 'security' 'repository-visibility' 'WARN' "not a GitHub origin: $origin"; return }
    try { $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$($m.Groups['o'].Value)/$($m.Groups['r'].Value)" -TimeoutSec 15 -UseBasicParsing; $public = -not $r.private } catch { $public = $false }
    if ($public) { Add-Check 'security' 'repository-visibility' 'WARN' 'the GitHub repository is PUBLIC: keep environments\*.json, toolchain.json, keys and history on this host only; make the repository private before committing any internal deployment configuration' }
    else { Add-Check 'security' 'repository-visibility' 'PASS' 'not publicly readable' }
  }
}

Write-Host ''
foreach ($c in $checks) {
  $colour = @{ PASS = 'Green'; WARN = 'Yellow'; BLOCKED = 'Red' }[$c.state]
  Write-Host ('{0,-8} {1,-12} {2,-28} {3}' -f $c.state, $c.area, $c.id, $c.detail) -ForegroundColor $colour
}
$blocked = @($checks | Where-Object state -eq 'BLOCKED').Count
Write-Host ''
Write-Host ("{0} PASS, {1} WARN, {2} BLOCKED" -f @($checks | Where-Object state -eq 'PASS').Count, @($checks | Where-Object state -eq 'WARN').Count, $blocked)
if ($Json) { Write-NiptJson ([ordered]@{ checkedAt = (Get-Date).ToString('o'); host = $env:COMPUTERNAME; blocked = $blocked; checks = @($checks) }) $Json }
exit $(if ($blocked) { 1 } else { 0 })

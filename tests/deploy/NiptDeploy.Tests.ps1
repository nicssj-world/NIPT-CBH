# Pester 3.4 (built into Windows PowerShell 5.1): Invoke-Pester -Script .\tests\deploy\NiptDeploy.Tests.ps1
# The orchestration helpers whose output another program parses: command-line quoting, engine JSON, install arguments.
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Import-Module (Join-Path $repo 'deploy\windows\NiptDeploy.psm1') -Force -DisableNameChecking

Describe 'deployment scripts' {
  It 'every script parses without errors' {
    $bad = @()
    foreach ($f in Get-ChildItem (Join-Path $repo 'deploy\windows') -Include *.ps1, *.psm1 -Recurse) {
      $errors = $null; [void][Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$null, [ref]$errors)
      if ($errors) { $bad += "$($f.Name): $($errors[0].Message)" }
    }
    ($bad -join '; ') | Should Be ''
  }
}

Describe 'ConvertTo-NiptCommandLine' {
  # round-trip through a real child process: what the program receives is what was meant
  $echo = Join-Path $env:TEMP "nipt-argv-$PID.ps1"
  Set-Content -LiteralPath $echo -Value '$args | ForEach-Object { "<" + $_ + ">" }' -Encoding ASCII
  It 'passes spaces, quotes, trailing backslashes and empty arguments intact' {
    $values = @('plain', 'with space', 'C:\Program Files\x\', 'say "hi"', 'RESET STAGING', 'a\\"b', '')
    $r = Invoke-NiptProcess -File (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -Arguments (@('-NoProfile', '-File', $echo) + $values) -Quiet
    $got = @($r.StdOut -split "`r?`n" | Where-Object { $_ -like '<*>' })
    $got.Count | Should Be $values.Count
    for ($i = 0; $i -lt $values.Count; $i++) { $got[$i] | Should Be ('<' + $values[$i] + '>') }
  }
  Remove-Item -LiteralPath $echo -ErrorAction SilentlyContinue
}

Describe 'Get-NiptLastJson' {
  It 'reads pretty engine output and one-line gate output' {
    (Get-NiptLastJson "{`n  `"ok`": false,`n  `"error`": `"X`"`n}`n").error | Should Be 'X'
    (Get-NiptLastJson "[package] log`n{`"package`":`"p`"}").package | Should Be 'p'
    Get-NiptLastJson '' | Should Be $null
  }
}

Describe 'Get-NiptInstallArguments' {
  $s = Get-Content (Join-Path $repo 'deploy\windows\environments\staging.example.json') -Raw | ConvertFrom-Json
  $p = Get-Content (Join-Path $repo 'deploy\windows\environments\production.example.json') -Raw | ConvertFrom-Json
  $p.bootstrap = [pscustomobject]@{ adminUser = 'lab.admin'; adminName = 'Lab Administrator' }
  It 'installs Staging as the test profile, protecting the Production root, on loopback, without bootstrap accounts' {
    $a = Get-NiptInstallArguments $s $p 'C:\pkg' 'C:\pub.pem'
    $joined = $a -join ' '
    $a[[array]::IndexOf($a, '--environment') + 1] | Should Be 'staging'
    $a[[array]::IndexOf($a, '--protected-roots') + 1] | Should Be $p.root
    $a[[array]::IndexOf($a, '--profile') + 1] | Should Be 'test'
    $a[[array]::IndexOf($a, '--ports') + 1] | Should Be '55442,3010,8443,3011'
    $joined -match '--lan' | Should Be $false
    $joined -match '--admin-user' | Should Be $false
  }
  It 'installs Production as the production profile with LAN host and the ONE bootstrap identity (APP_ADMIN)' {
    $a = Get-NiptInstallArguments $p $s 'C:\pkg' 'C:\pub.pem'
    $a[[array]::IndexOf($a, '--environment') + 1] | Should Be 'production'
    $a[[array]::IndexOf($a, '--protected-roots') + 1] | Should Be $s.root
    $a[[array]::IndexOf($a, '--host') + 1] | Should Be 'nipt-cbh'
    $a[[array]::IndexOf($a, '--admin-user') + 1] | Should Be $p.bootstrap.adminUser
    $a[[array]::IndexOf($a, '--admin-name') + 1] | Should Be $p.bootstrap.adminName
    ($a -join ' ') -match '--checker' | Should Be $false
  }
  It 'binds Production HTTPS to the configured LAN adapter and firewall profile' {
    $q = $p | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $q.lan | Add-Member -NotePropertyName listen -NotePropertyValue '192.168.72.194'; $q.lan | Add-Member -NotePropertyName profiles -NotePropertyValue 'Private'
    $a = Get-NiptInstallArguments $q $s 'C:\pkg' 'C:\pub.pem'
    $a[[array]::IndexOf($a, '--https-host') + 1] | Should Be '192.168.72.194'
    $a[[array]::IndexOf($a, '--lan-profiles') + 1] | Should Be 'Private'
  }
}

Describe 'Get-NiptPublicKey' {
  It 'derives the public key file beside the private key' {
    Get-NiptPublicKey ([pscustomobject]@{ signingKey = 'C:\NIPT-CBH\deploy\keys\staging\package-signing-private.pem' }) | Should Be 'C:\NIPT-CBH\deploy\keys\staging\package-signing-public.pem'
  }
}

Describe 'retention of old releases and builds (Owner 2026-11-11)' {
  # A sandbox environment root and builds folder; no real Production folder is read or touched.
  $box = Join-Path $env:TEMP "nipt-retention-$PID"
  $root = Join-Path $box 'env'; $builds = Join-Path $box 'builds'
  New-Item -ItemType Directory -Force -Path (Join-Path $root 'releases'), $builds | Out-Null
  $day = [datetime]'2026-11-01'
  1..9 | ForEach-Object {
    $d = Join-Path (Join-Path $root 'releases') ('1.1.2-r{0:D2}' -f $_); New-Item -ItemType Directory -Force -Path $d | Out-Null
    Set-Content -LiteralPath (Join-Path $d 'app.bin') -Value ('x' * 1000); (Get-Item -LiteralPath $d).LastWriteTime = $day.AddDays($_)
    $b = Join-Path $builds ('{0:D12}' -f $_); New-Item -ItemType Directory -Force -Path (Join-Path $b 'node_modules') | Out-Null
    Set-Content -LiteralPath (Join-Path $b 'node_modules\m.js') -Value ('y' * 500); (Get-Item -LiteralPath $b).LastWriteTime = $day.AddDays($_)
  }
  # r02 is the previous release and r03 the installed one: both are old, and both must survive.
  $state = [ordered]@{ current = @{ version = '1.1.2-r03'; revision = ('{0:D12}' -f 3) + ('0' * 28) }; previous = @{ version = '1.1.2-r02'; revision = ('{0:D12}' -f 2) + ('0' * 28) } }
  [IO.File]::WriteAllText((Join-Path $root 'install-state.json'), (ConvertTo-Json $state -Depth 4), (New-Object Text.UTF8Encoding $false))
  $tc = [pscustomobject]@{ Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source; Builds = $builds; Source = $box; Git = $null }
  $cfg = [pscustomobject]@{ root = $root; instance = 'sandbox' }
  if (-not $tc.Node) { $tc.Node = 'C:\NIPT-CBH\toolchain\node\node.exe' }

  It 'plans the newest 3 plus the installed and previous release, and removes nothing while planning' {
    $plan = Get-NiptRetentionPlan $tc $cfg 3 3 -EnvRoots @($root)
    $rel = $plan.areas | Where-Object { $_.kind -eq 'RELEASE' }
    (@($rel.remove | ForEach-Object { $_.name }) -join ',') | Should Be '1.1.2-r01,1.1.2-r04,1.1.2-r05,1.1.2-r06'
    (@($rel.kept | ForEach-Object { $_.name }) -join ',') | Should Be '1.1.2-r09,1.1.2-r08,1.1.2-r07,1.1.2-r03,1.1.2-r02'
    $bld = $plan.areas | Where-Object { $_.kind -eq 'BUILD' }
    (@($bld.remove | ForEach-Object { $_.name }) -join ',') | Should Be '000000000001,000000000004,000000000005,000000000006'
    ($plan.reclaimBytes -gt 0) | Should Be $true
    @(Get-ChildItem (Join-Path $root 'releases')).Count | Should Be 9
    @(Get-ChildItem $builds).Count | Should Be 9
  }
  It 'removes only the planned folders when applied, deleting a tree that holds node_modules, and never the installed or previous release' {
    $plan = Get-NiptRetentionPlan $tc $cfg 3 3 -EnvRoots @($root)
    $r = Invoke-NiptRetention $tc $plan -Apply
    @($r.failed).Count | Should Be 0
    @($r.removed).Count | Should Be 8
    (@(Get-ChildItem (Join-Path $root 'releases') | ForEach-Object { $_.Name } | Sort-Object) -join ',') | Should Be '1.1.2-r02,1.1.2-r03,1.1.2-r07,1.1.2-r08,1.1.2-r09'
    (@(Get-ChildItem $builds | ForEach-Object { $_.Name } | Sort-Object) -join ',') | Should Be '000000000002,000000000003,000000000007,000000000008,000000000009'
    (Test-Path (Join-Path $root 'install-state.json')) | Should Be $true
  }
  It 'refuses a keep count below 3 and an environment with nothing installed' {
    { Get-NiptRetentionPlan $tc $cfg 2 3 -EnvRoots @($root) } | Should Throw 'RETENTION_KEEP_TOO_SMALL'
    { Get-NiptRetentionPlan $tc ([pscustomobject]@{ root = (Join-Path $box 'none'); instance = 'x' }) 3 3 -EnvRoots @() } | Should Throw 'RETENTION_NO_INSTALLED_RELEASE'
  }
  It 'adds up nothing as 0 bytes: an empty folder and an empty list (Windows PowerShell 5.1 strict mode)' {
    $empty = Join-Path $box 'empty-folder'; New-Item -ItemType Directory -Force -Path $empty | Out-Null
    (Get-NiptFolderBytes $empty) | Should Be 0
    (Get-NiptSum @() 'bytes') | Should Be 0
    (Get-NiptSum @([pscustomobject]@{ bytes = 5 }, [pscustomobject]@{ bytes = 7 }) 'bytes') | Should Be 12
  }
  It 'a post-deploy retention that fails only logs and never throws' {
    { Invoke-NiptPostDeployRetention $tc ([pscustomobject]@{ root = (Join-Path $box 'none'); instance = 'x' }) } | Should Not Throw
  }
  Remove-Item -LiteralPath $box -Recurse -Force -ErrorAction SilentlyContinue
}

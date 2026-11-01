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
  $p.bootstrap = [pscustomobject]@{ adminUser = 'lab.admin'; adminName = 'Lab Administrator'; checkerUser = 'clin.approver'; checkerName = 'Clinical Approver' }
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
  It 'installs Production as the production profile with LAN host and the two bootstrap identities' {
    $a = Get-NiptInstallArguments $p $s 'C:\pkg' 'C:\pub.pem'
    $a[[array]::IndexOf($a, '--environment') + 1] | Should Be 'production'
    $a[[array]::IndexOf($a, '--protected-roots') + 1] | Should Be $s.root
    $a[[array]::IndexOf($a, '--host') + 1] | Should Be 'nipt-cbh'
    $a[[array]::IndexOf($a, '--admin-user') + 1] | Should Be $p.bootstrap.adminUser
    $a[[array]::IndexOf($a, '--checker-user') + 1] | Should Be $p.bootstrap.checkerUser
  }
}

Describe 'Get-NiptPublicKey' {
  It 'derives the public key file beside the private key' {
    Get-NiptPublicKey ([pscustomobject]@{ signingKey = 'C:\NIPT-CBH\deploy\keys\staging\package-signing-private.pem' }) | Should Be 'C:\NIPT-CBH\deploy\keys\staging\package-signing-public.pem'
  }
}

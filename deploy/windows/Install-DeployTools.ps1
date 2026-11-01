<#
.SYNOPSIS  Install (or update) the deployment tools into C:\NIPT-CBH\deploy from THIS checkout. Run from the source checkout.
.DESCRIPTION
  An explicit step on purpose: editing or pulling the source never changes the tools that deploy Production. The tools copied are
  recorded with their commit (deploy\tools-version.json). Creates the C:\NIPT-CBH layout (never the environment roots' contents: the
  engine installs those), restricts deploy\ to the administrator, SYSTEM and Administrators (keys and history live there), and creates
  environments\*.json and toolchain.json from the templates ONLY when they do not exist yet. Existing files are never overwritten.
.EXAMPLE   powershell -ExecutionPolicy Bypass -File C:\NIPT-CBH\source\NIPT-CBH\deploy\windows\Install-DeployTools.ps1
#>
[CmdletBinding()]
param([string]$NiptHome = 'C:\NIPT-CBH')
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = (Resolve-Path (Join-Path $here '..\..')).Path
$commit = (& git -C $repo rev-parse HEAD).Trim()
$dirty = (& git -C $repo status --porcelain --untracked-files=normal -- deploy/windows docs/deployment)
if ($dirty) { Write-Host "REFUSED: deploy\windows or docs\deployment has uncommitted changes in $repo; commit them first so the installed tools have a known revision." -ForegroundColor Red; exit 1 }

$deploy = Join-Path $NiptHome 'deploy'
foreach ($d in @($NiptHome, (Join-Path $NiptHome 'source'), (Join-Path $NiptHome 'source\builds'), $deploy, (Join-Path $deploy 'environments'), (Join-Path $deploy 'keys'), (Join-Path $deploy 'history'), (Join-Path $NiptHome 'assets'), (Join-Path $NiptHome 'assets\forms'), (Join-Path $NiptHome 'toolchain'), (Join-Path $NiptHome 'documentation'))) {
  if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d | Out-Null; Write-Host "created $d" }
}
& icacls.exe $deploy /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
& icacls.exe (Join-Path $NiptHome 'assets') /inheritance:r /grant:r "$($env:USERDOMAIN)\$($env:USERNAME):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null

$tools = @('NiptDeploy.psm1', 'deploy-gates.mjs', 'deploy-staging.ps1', 'deploy-production.ps1', 'rollback-production.ps1', 'health-check.ps1', 'preflight.ps1', 'reset-staging.ps1', 'test-isolation.ps1', 'provision-identities.ps1')
foreach ($f in $tools) { Copy-Item -LiteralPath (Join-Path $here $f) -Destination (Join-Path $deploy $f) -Force }
foreach ($pair in @(@('environments\staging.example.json', 'environments\staging.json'), @('environments\production.example.json', 'environments\production.json'), @('toolchain.example.json', 'toolchain.json'))) {
  $target = Join-Path $deploy $pair[1]
  if (Test-Path -LiteralPath $target) { Write-Host "kept existing $target" } else { Copy-Item -LiteralPath (Join-Path $here $pair[0]) -Destination $target; Write-Host "created $target from template: review it" -ForegroundColor Yellow }
}
foreach ($doc in @(Get-ChildItem -LiteralPath (Join-Path $repo 'docs\deployment') -Filter '*.md')) { Copy-Item -LiteralPath $doc.FullName -Destination (Join-Path (Join-Path $NiptHome 'documentation') $doc.Name) -Force }
[IO.File]::WriteAllText((Join-Path $deploy 'tools-version.json'), (ConvertTo-Json -InputObject ([ordered]@{ commit = $commit; installedAt = (Get-Date).ToString('o'); by = "$env:USERDOMAIN\$env:USERNAME"; from = $repo; files = $tools }) -Depth 4), (New-Object Text.UTF8Encoding $false))
Write-Host ''
Write-Host "Deployment tools from commit $commit installed in $deploy" -ForegroundColor Green
Write-Host "Next: review $deploy\environments\*.json and toolchain.json, place the approved assets in $NiptHome\assets, then run $deploy\preflight.ps1"

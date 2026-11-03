<#
.SYNOPSIS  Place the owner's approved NIFTY / HALOS Task Import / Pooling CSV templates next to the approved master workbook of one environment.
.DESCRIPTION
  The application finds them in <Root>\data\master (pooling.csv, nifty.xlsx, halos-task.xlsx) when the NIPT_*_TEMPLATE variables are not set. That folder is persistent,
  so application-only upgrades keep the files. Each file is checked against the SHA-256 the application pins (a different file is refused, nothing is copied).
  Run elevated. Production and Staging roots are never mixed: pass the one you mean.
.EXAMPLE   .\provision-export-templates.ps1 -Root C:\NIPT-CBH\production -Source D:\NIPT-CBH\.local\approved
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Root,
  [Parameter(Mandatory)][string]$Source
)
$ErrorActionPreference = 'Stop'
$pins = [ordered]@{
  'pooling.csv'     = '2ea12e86e1429be6ad9720c3b1b45f90588ad5c1316548146b5062b16bd6977a'
  'nifty.xlsx'      = '07c2cd582b85769b789a0ec1f952d623664366c96dcbc28953b1c3c8b07a0ebc'
  'halos-task.xlsx' = '1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec'
}
$master = Join-Path $Root 'data\master'
if (-not (Test-Path -LiteralPath (Join-Path $master 'approved-master.xlsx'))) { throw "NOT_AN_INSTALLATION_ROOT: $master has no approved-master.xlsx" }
foreach ($name in $pins.Keys) {
  $file = Join-Path $Source $name
  if (-not (Test-Path -LiteralPath $file)) { throw "TEMPLATE_MISSING: $file" }
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $pins[$name]) { throw "TEMPLATE_SHA256_MISMATCH: $name is $hash, pinned $($pins[$name])" }
}
foreach ($name in $pins.Keys) {
  Copy-Item -LiteralPath (Join-Path $Source $name) -Destination (Join-Path $master $name) -Force
  $after = (Get-FileHash -LiteralPath (Join-Path $master $name) -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($after -ne $pins[$name]) { throw "COPY_VERIFY_FAILED: $name" }
  Write-Host "OK  $name  $after  ->  $master" -ForegroundColor Green
}
Write-Host 'DONE: the three export templates are in place and match their pins.' -ForegroundColor Green

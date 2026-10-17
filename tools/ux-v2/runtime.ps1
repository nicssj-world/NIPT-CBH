[CmdletBinding()]
param([ValidateSet('Start','Stop','Status','RebuildWeb')][string]$Action='Status')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if((Split-Path $root -Leaf) -ne 'NIPT-CBH-UX-V2-IMPLEMENTATION'){throw 'ISOLATED_UX_WORKTREE_REQUIRED'}
Set-Location -LiteralPath $root
if((& git branch --show-current).Trim() -ne 'feat/premium-ux-v2-local'){throw 'ISOLATED_UX_BRANCH_REQUIRED'}
$compose=@('compose','--project-directory',$root,'-p','nipt-ux-v2-local-20261017','-f','tools/ux-v2/runtime.compose.yaml','-f','tools/ux-v2/web.local.compose.yaml')
if($Action -eq 'Status'){& docker @compose ps -a; exit $LASTEXITCODE}
if($Action -eq 'Stop'){& docker @compose stop; exit $LASTEXITCODE}
if($Action -eq 'RebuildWeb'){
 $sha=(& git rev-parse HEAD).Trim()
 $hash=(& node --input-type=module -e "import {migrationInventory} from './deploy/scripts/release-contract.mjs'; console.log((await migrationInventory('db/migrations')).sha256)").Trim()
 & docker build --target web --build-arg "SOURCE_REVISION=$sha" --build-arg "MIGRATIONS_SHA256=$hash" -t nipt-ux-v2-local-web:20261017 .
 if($LASTEXITCODE -ne 0){throw 'LOCAL_WEB_BUILD_FAILED'}
 & docker @compose up -d --no-deps web
 exit $LASTEXITCODE
}
# Starts only this prepared isolated project; preserves DB and local fixture files.
if(-not(Test-Path -LiteralPath '.local/ux-v2/secrets/uat-accounts.json')){throw 'PROVISION_LOCAL_FILES_FIRST'}
& docker @compose up -d
exit $LASTEXITCODE

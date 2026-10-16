[CmdletBinding()]
param(
  [ValidateSet('Start','Stop','Restart','Health','Logs','StagePET','ListFixtures','SeedPositiveJourney')]
  [string]$Action='Health',
  [string]$MasterPath='C:\Users\User\Downloads\NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx',
  [string]$FixtureId='',
  [ValidateSet(1,2)][int]$Round=1
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location -LiteralPath $RepoRoot
$LocalRoot=Join-Path $RepoRoot '.local\home-operational-uat'
$ComposeFile=Join-Path $PSScriptRoot 'home-uat.compose.yaml'
$Project='nipt-home-operational-uat-20261017'
$Origin='https://127.0.0.1:19444'
$ExpectedMaster='0f94efbc240b9a38ff9be77bf0c8d92c09d82fa2fe2427b9d274cc739e5607a6'
$MasterCopy=Join-Path $LocalRoot 'master\approved-combined.xlsx'
$Secrets=Join-Path $LocalRoot 'secrets'
$Spool=Join-Path $LocalRoot 'excel-spool'
$BridgeScript=Join-Path $PSScriptRoot 'native-excel-bridge.ps1'
$ExportScript=Join-Path $RepoRoot 'packages\workbook\native-export.ps1'
$Checkpoint=Join-Path $LocalRoot 'checkpoint.json'

function Save-Checkpoint([string]$Step,[string]$Result='IN_PROGRESS') {
  if(-not (Test-Path -LiteralPath $LocalRoot)){return}
  $record=[ordered]@{project=$Project;branch='local/home-operational-uat-20261017';step=$Step;result=$Result;updatedAt=[DateTime]::UtcNow.ToString('o')}
  $temporary=$Checkpoint+'.tmp'
  [IO.File]::WriteAllText($temporary,($record|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $Checkpoint -Force
}
function Set-LocalAcl {
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls.exe $LocalRoot /inheritance:r /grant:r ("*{0}:(OI)(CI)F" -f $sid) '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /T /C | Out-Null
  if($LASTEXITCODE -ne 0){throw 'HOME_UAT_LOCAL_ACL_FAILED'}
}
function Initialize-LocalFiles {
  New-Item -ItemType Directory -Path $LocalRoot -Force|Out-Null
  Set-LocalAcl
  & node (Join-Path $PSScriptRoot 'home-uat-provision.mjs') $LocalRoot $MasterPath
  if($LASTEXITCODE -ne 0){throw 'HOME_UAT_LOCAL_PROVISION_FAILED'}
  $hash=(Get-FileHash -LiteralPath $MasterCopy -Algorithm SHA256).Hash.ToLower()
  if($hash -ne $ExpectedMaster){throw 'HOME_UAT_MASTER_SHA256_MISMATCH'}
  (Get-Item -LiteralPath $MasterCopy).IsReadOnly=$true
  foreach($folder in @('files','integration\inbound','integration\results','positive-journey\outbound\res','positive-journey\outbound\pdf','positive-journey\outbound\backup','excel-spool\inbox','excel-spool\processing','excel-spool\outbox','fixtures')){
    New-Item -ItemType Directory -Path (Join-Path $LocalRoot $folder) -Force|Out-Null
  }
  Set-LocalAcl
  $env:NIPT_MODE='operational'
  $env:NIPT_HOME_UAT_FIXTURE_ROOT=Join-Path $LocalRoot 'fixtures'
  $env:NIPT_HOME_UAT_SIMULATOR_ROOT=Join-Path $LocalRoot 'integration'
  & node --import tsx (Join-Path $PSScriptRoot 'seed-home-uat-fixtures.ts')
  if($LASTEXITCODE -ne 0){throw 'HOME_UAT_FIXTURE_PROVISION_FAILED'}
  Save-Checkpoint 'local-files-and-fixtures-ready' 'PASS'
}
function Set-ComposeContract([switch]$RequireClean) {
  if($RequireClean) {
    $branch=(& git -C $RepoRoot branch --show-current).Trim()
    if($branch -ne 'local/home-operational-uat-20261017'){throw 'HOME_UAT_BRANCH_MISMATCH'}
    $dirty=@(& git -C $RepoRoot status --porcelain)
    if($dirty.Count -gt 0){throw 'HOME_UAT_SOURCE_MUST_BE_COMMITTED_BEFORE_BUILD'}
  }
  $source=(& git -C $RepoRoot rev-parse HEAD).Trim()
  if($LASTEXITCODE -ne 0 -or $source -notmatch '^[a-f0-9]{40}$'){throw 'HOME_UAT_SOURCE_REVISION_UNAVAILABLE'}
  $inventoryCommand="import {migrationInventory} from './deploy/scripts/release-contract.mjs'; const x=await migrationInventory('db/migrations'); console.log(x.sha256)"
  $migrationHash=(& node --input-type=module -e $inventoryCommand).Trim()
  if($LASTEXITCODE -ne 0 -or $migrationHash -notmatch '^[a-f0-9]{64}$'){throw 'HOME_UAT_MIGRATION_INVENTORY_UNAVAILABLE'}
  $env:SOURCE_REVISION=$source
  $env:MIGRATIONS_SHA256=$migrationHash
}
function Invoke-Compose([string[]]$Arguments) {
  $prefix=@('--project-name',$Project,'--project-directory',$RepoRoot,'--file',$ComposeFile)
  $all=$prefix+$Arguments
  & docker compose @all
  if($LASTEXITCODE -ne 0){throw 'HOME_UAT_COMPOSE_COMMAND_FAILED'}
}
function Get-ServiceId([string]$Service) {
  $prefix=@('--project-name',$Project,'--project-directory',$RepoRoot,'--file',$ComposeFile)
  $id=(& docker compose @prefix ps -q --all $Service | Select-Object -First 1)
  if($LASTEXITCODE -ne 0){throw 'HOME_UAT_COMPOSE_STATUS_FAILED'}
  if($id){return $id.Trim()}
  return ''
}
function Get-ContainerState([string]$Id) {
  if(-not $Id){return 'NOT_CREATED'}
  $state=(& docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.ExitCode}}' $Id).Trim()
  if($LASTEXITCODE -ne 0){return 'UNKNOWN'}
  return $state
}
function Get-DatabaseScalar([string]$Sql) {
  $id=Get-ServiceId 'db';if(-not $id){throw 'HOME_UAT_DATABASE_NOT_RUNNING'}
  $value=(& docker exec $id psql -U nipt_migrator -d nipt_operational_home_uat -Atqc $Sql)
  if($LASTEXITCODE -ne 0){throw 'HOME_UAT_DATABASE_QUERY_FAILED'}
  return (($value|Out-String).Trim())
}
function Get-PersistenceSnapshot {
  Get-DatabaseScalar "SELECT (SELECT count(*) FROM nipt_case)::text||'|'||(SELECT count(*) FROM lab_batch)::text||'|'||(SELECT count(*) FROM result_release)::text||'|'||(SELECT count(*) FROM p6_transfer)::text"
}
function Get-WorkerRuntime([string]$Id) {
  if(-not $Id){return 'NOT_RUNNING'}
  $code="const u=new URL(process.env.DATABASE_URL);console.log(process.env.NIPT_MODE+'|'+decodeURIComponent(u.pathname.slice(1)))"
  $value=(& docker exec $Id node --import ./tools/runtime-env.mjs --input-type=module -e $code)
  if($LASTEXITCODE -ne 0){return 'UNAVAILABLE'}
  return (($value|Out-String).Trim())
}
function Ensure-NativeBridge {
  $excel=@('C:\Program Files\Microsoft Office\root\Office16\EXCEL.EXE','C:\Program Files\Microsoft Office\Office16\EXCEL.EXE')|Where-Object{Test-Path -LiteralPath $_}|Select-Object -First 1
  if(-not $excel){throw 'HOME_UAT_EXCEL_DESKTOP_REQUIRED'}
  if(-not (Get-Command Get-PrintConfiguration -ErrorAction SilentlyContinue)){throw 'HOME_UAT_PRINTMANAGEMENT_REQUIRED'}
  $pwsh=(Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
  if(-not $pwsh){throw 'HOME_UAT_POWERSHELL_REQUIRED'}
  $pidFile=Join-Path $Spool 'bridge.launcher.pid'
  if(Test-Path -LiteralPath $pidFile) {
    $savedPid=0;[void][int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(),[ref]$savedPid)
    if($savedPid -gt 0) {
      $existing=Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid" -ErrorAction SilentlyContinue
      if($existing -and $existing.CommandLine.Contains('native-excel-bridge.ps1') -and $existing.CommandLine.Contains($Spool)){return}
    }
  }
  $stdout=Join-Path $Spool 'bridge.stdout.log';$stderr=Join-Path $Spool 'bridge.stderr.log'
  $args=@('-NoLogo','-NoProfile','-NonInteractive','-File',('"'+$BridgeScript+'"'),'-Root',('"'+$Spool+'"'),'-ExportScript',('"'+$ExportScript+'"')) -join ' '
  $process=Start-Process -FilePath $pwsh -ArgumentList $args -WorkingDirectory $RepoRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  Set-Content -LiteralPath $pidFile -Value $process.Id -NoNewline
  $deadline=[DateTime]::UtcNow.AddSeconds(20)
  while([DateTime]::UtcNow -lt $deadline) {
    if($process.HasExited){throw 'HOME_UAT_EXCEL_BRIDGE_FAILED_TO_START'}
    $statusFile=Join-Path $Spool 'bridge-status.json'
    if(Test-Path -LiteralPath $statusFile) {
      $status=Get-Content -LiteralPath $statusFile -Raw|ConvertFrom-Json
      if($status.pid -eq $process.Id -and $status.state -eq 'idle'){return}
    }
    Start-Sleep -Milliseconds 250
  }
  throw 'HOME_UAT_EXCEL_BRIDGE_HEALTH_TIMEOUT'
}
function Request-StopNativeBridge([int]$WaitSeconds=20) {
  $pidFile=Join-Path $Spool 'bridge.launcher.pid'
  if(-not (Test-Path -LiteralPath $pidFile)){return $true}
  $savedPid=0;[void][int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(),[ref]$savedPid)
  if($savedPid -le 0){return $true}
  $process=Get-Process -Id $savedPid -ErrorAction SilentlyContinue
  if(-not $process){return $true}
  $command=Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid" -ErrorAction SilentlyContinue
  if(-not $command -or -not $command.CommandLine.Contains('native-excel-bridge.ps1') -or -not $command.CommandLine.Contains($Spool)){throw 'HOME_UAT_BRIDGE_PID_MISMATCH'}
  Set-Content -LiteralPath (Join-Path $Spool 'stop.request') -Value 'stop' -NoNewline
  $deadline=[DateTime]::UtcNow.AddSeconds($WaitSeconds)
  while([DateTime]::UtcNow -lt $deadline) {
    if(-not (Get-Process -Id $savedPid -ErrorAction SilentlyContinue)){return $true}
    Start-Sleep -Milliseconds 300
  }
  return $false
}
function Test-LoginAccounts {
  $loginPage=Invoke-WebRequest -Uri ($Origin+'/login') -Method Get -SkipCertificateCheck -TimeoutSec 30
  if($loginPage.StatusCode -ne 200 -or -not $loginPage.Content.Contains('TRAINING / LOCAL UAT')){throw 'HOME_UAT_LOGIN_PAGE_OR_BANNER_FAILED'}
  $accounts=Get-Content -LiteralPath (Join-Path $Secrets 'uat-accounts.json') -Raw|ConvertFrom-Json
  $checks=@()
  foreach($account in $accounts) {
    $session=[Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $csrfResponse=Invoke-WebRequest -Uri ($Origin+'/api/auth/csrf') -Method Get -WebSession $session -SkipCertificateCheck -TimeoutSec 30
    $csrf=(ConvertFrom-Json $csrfResponse.Content).csrf
    $body=@{username=$account.username;password=$account.password;csrf=$csrf}|ConvertTo-Json -Compress
    $login=Invoke-WebRequest -Uri ($Origin+'/api/auth/login') -Method Post -WebSession $session -SkipCertificateCheck -TimeoutSec 30 -Headers @{Origin=$Origin} -ContentType 'application/json' -Body $body
    if((ConvertFrom-Json $login.Content).ok -ne $true){throw 'HOME_UAT_LOGIN_REJECTED'}
    $meResponse=Invoke-WebRequest -Uri ($Origin+'/api/me') -Method Get -WebSession $session -SkipCertificateCheck -TimeoutSec 30
    $me=ConvertFrom-Json $meResponse.Content
    if($me.roles -notcontains $account.role){throw 'HOME_UAT_ROLE_ASSIGNMENT_MISMATCH'}
    $cookie=$session.Cookies.GetCookies([uri]$Origin)|Where-Object Name -eq 'nipt_session'|Select-Object -First 1
    if(-not $cookie -or -not $cookie.Secure){throw 'HOME_UAT_SECURE_COOKIE_REQUIRED'}
    $null=Invoke-WebRequest -Uri ($Origin+'/api/auth/logout') -Method Post -WebSession $session -SkipCertificateCheck -TimeoutSec 30 -Headers @{Origin=$Origin;'x-csrf-token'=$me.csrf}
    $checks+=@{role=$account.role;authentication='PASS';rbacIdentity='PASS';secureCookie='PASS'}
  }
  return $checks
}
function Get-HomeHealth {
  $services=[ordered]@{}
  foreach($name in @('db','migrate','fixture-seed','renderer','worker','web','proxy')){$services[$name]=Get-ContainerState (Get-ServiceId $name)}
  $ids=@{db=(Get-ServiceId 'db');renderer=(Get-ServiceId 'renderer');worker=(Get-ServiceId 'worker');web=(Get-ServiceId 'web');proxy=(Get-ServiceId 'proxy')}
  $databaseMode='NOT_RUNNING';$workerFresh='NOT_RUNNING';$webRuntime='NOT_RUNNING';$workerRuntime='NOT_RUNNING';$renderer='NOT_RUNNING';$webHealth='NOT_RUNNING';$counts='NOT_RUNNING';$transferMode='NOT_RUN';$networks='NOT_VERIFIED';$publication='NOT_VERIFIED';$masterMount='NOT_VERIFIED';$logins=@()
  try {$databaseMode=Get-DatabaseScalar "SELECT current_database()||'|'||mode||'|'||nipt_operational_enabled() FROM nipt_runtime_config WHERE singleton=true"}catch{}
  try {$workerFresh=Get-DatabaseScalar "SELECT CASE WHEN observed_at>now()-interval '120 seconds' THEN 'FRESH' ELSE 'STALE' END FROM worker_heartbeat WHERE worker_id='operational-worker'"}catch{}
  try {$counts=Get-DatabaseScalar "SELECT (SELECT count(*) FROM nipt_case)::text||' cases | '||(SELECT count(*) FROM lab_batch)::text||' batches | '||(SELECT count(*) FROM result_release)::text||' local releases'"}catch{}
  try {$transferMode=Get-DatabaseScalar "SELECT CASE WHEN count(*)=0 THEN 'NO_LOCAL_TRANSFER_YET' WHEN bool_and(COALESCE(model->>'hisConfirmed','false')='false') THEN 'LOCAL_ONLY_HIS_UNCONFIRMED' ELSE 'CHECK_REQUIRED' END FROM p6_transfer"}catch{}
  try {$webRuntime=Get-WorkerRuntime $ids.web}catch{}
  try {$workerRuntime=Get-WorkerRuntime $ids.worker}catch{}
  if($ids.worker) {
    try {
      $code="const fs=require('node:fs');const t=fs.readFileSync('/run/secrets/renderer_token','utf8').trim();fetch('http://renderer:3001/health',{headers:{authorization:'Bearer '+t}}).then(r=>process.stdout.write(String(r.status))).catch(()=>process.exit(1))"
      $renderer=(& docker exec $ids.worker node -e $code).Trim()
      if($LASTEXITCODE -ne 0){$renderer='UNAVAILABLE'}
    }catch{$renderer='UNAVAILABLE'}
  }
  if($ids.web) {
    try {
      $response=Invoke-WebRequest -Uri ($Origin+'/api/health') -Method Get -SkipCertificateCheck -TimeoutSec 10
      $health=ConvertFrom-Json $response.Content
      $webHealth=$health.status+'|'+$health.mode
    }catch{$webHealth='UNAVAILABLE'}
  }
  try {
    $networkList=@()
    foreach($networkName in @($Project+'_data',$Project+'_render',$Project+'_proxy',$Project+'_ingress')) {
      $internal=(& docker network inspect --format '{{.Internal}}' $networkName).Trim()
      $networkList+=@{name=$networkName;internal=($internal -eq 'true')}
    }
    $masquerade=(& docker network inspect --format '{{index .Options "com.docker.network.bridge.enable_ip_masquerade"}}' ($Project+'_ingress')).Trim()
    $networks=@{internalNetworks=$networkList;ingressMasqueradeDisabled=($masquerade -eq 'false')}
  }catch{$networks='NOT_VERIFIED'}
  try {
    $proxyBindingRaw=& docker inspect --format '{{json .HostConfig.PortBindings}}' $ids.proxy
    $dbBindingRaw=& docker inspect --format '{{json .HostConfig.PortBindings}}' $ids.db
    $proxyObject=$proxyBindingRaw|ConvertFrom-Json;$dbObject=$dbBindingRaw|ConvertFrom-Json
    $proxyBindings=$proxyObject.PSObject.Properties['443/tcp'].Value
    $dbBindings=$dbObject.PSObject.Properties['5432/tcp'].Value
    $proxyLocal=@($proxyBindings|Where-Object{$_.HostIp -eq '127.0.0.1' -and $_.HostPort -eq '19444'}).Count -eq 1
    $dbLocal=@($dbBindings|Where-Object{$_.HostIp -eq '127.0.0.1' -and $_.HostPort -eq '19445'}).Count -eq 1
    $otherClear=$true
    foreach($serviceName in @('renderer','worker','web')) {
      $serviceId=Get-ServiceId $serviceName
      $raw=& docker inspect --format '{{json .HostConfig.PortBindings}}' $serviceId
      if($raw -and $raw.Trim() -ne 'null' -and $raw.Trim() -ne '{}'){$otherClear=$false}
    }
    $publication=@{httpsLoopbackOnly=$proxyLocal;databaseLoopbackOnly=$dbLocal;otherServicePorts=$(if($otherClear){'NONE'}else{'UNEXPECTED'})}
  }catch{$publication='NOT_VERIFIED'}
  try {
    $mounts=(& docker inspect --format '{{json .Mounts}}' $ids.web)|ConvertFrom-Json
    $mount=$mounts|Where-Object Destination -eq '/approved/master.xlsx'|Select-Object -First 1
    $masterMount=@{present=($null -ne $mount);readOnly=($mount -and -not $mount.RW);sha256=(Get-FileHash -LiteralPath $MasterCopy -Algorithm SHA256).Hash.ToLower()}
  }catch{$masterMount='NOT_VERIFIED'}
  $bridgeAlive=$false;$bridgeState='NOT_RUNNING'
  try {
    $pidValue=0;[void][int]::TryParse((Get-Content -LiteralPath (Join-Path $Spool 'bridge.launcher.pid') -Raw).Trim(),[ref]$pidValue)
    $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction SilentlyContinue
    $status=Get-Content -LiteralPath (Join-Path $Spool 'bridge-status.json') -Raw|ConvertFrom-Json
    $age=([DateTime]::UtcNow-[DateTime]::Parse($status.updatedAt).ToUniversalTime()).TotalSeconds
    $bridgeAlive=($proc -and $proc.CommandLine.Contains('native-excel-bridge.ps1') -and $status.pid -eq $pidValue -and (($status.state -eq 'idle' -and $age -lt 10)-or($status.state -eq 'processing' -and $age -lt 240)))
    $bridgeState=if($bridgeAlive){$status.state.ToUpper()}else{'UNAVAILABLE'}
  }catch{}
  try {$logins=Test-LoginAccounts}catch{$logins=@(@{authentication='FAILED';reason='ROLE_LOGIN_CHECK_FAILED'})}
  $modeCorrect=($databaseMode -eq 'nipt_operational_home_uat|operational|true' -and $webRuntime -eq 'operational|nipt_operational_home_uat' -and $workerRuntime -eq 'operational|nipt_operational_home_uat')
  $servicesHealthy=($services.db -like 'running|healthy|*' -and $services.renderer -like 'running|healthy|*' -and $services.worker -like 'running|*' -and $services.web -like 'running|*' -and $services.proxy -like 'running|*')
  $loginPass=($logins.Count -eq 6 -and @($logins|Where-Object authentication -ne 'PASS').Count -eq 0)
  $portsCorrect=$false
  if($publication -is [System.Collections.IDictionary]){$portsCorrect=($publication.httpsLoopbackOnly -and $publication.databaseLoopbackOnly -and $publication.otherServicePorts -eq 'NONE')}
  $networkCorrect=$false
  if($networks -is [System.Collections.IDictionary]){$networkCorrect=($networks.ingressMasqueradeDisabled -and $networks.internalNetworks.Count -eq 4 -and @($networks.internalNetworks|Where-Object{-not $_.internal}).Count -eq 0)}
  $masterCorrect=$false
  if($masterMount -is [System.Collections.IDictionary]){$masterCorrect=($masterMount.present -and $masterMount.readOnly -and $masterMount.sha256 -eq $ExpectedMaster)}
  $ready=($servicesHealthy -and $modeCorrect -and $workerFresh -eq 'FRESH' -and $renderer -eq '200' -and $webHealth -eq 'ok|operational' -and $loginPass -and $bridgeAlive -and $masterCorrect -and $portsCorrect -and $networkCorrect)
  return [ordered]@{
    ready=$ready;url=($Origin+'/login');runtimeMode=@{web=$webRuntime;worker=$workerRuntime;database=$databaseMode}
    services=$services;webHealth=$webHealth;workerHeartbeat=$workerFresh;rendererHealth=$renderer
    localExcelBridge=$bridgeState;master=$masterMount;publishedPorts=$publication;networkIsolation=$networks
    localAccounts=$logins;testData=$counts;localP6=$transferMode
    credentialsFile=(Join-Path $LocalRoot 'credentials.txt')
  }
}
function Wait-QuickHealth([int]$Seconds=300) {
  $deadline=[DateTime]::UtcNow.AddSeconds($Seconds)
  while([DateTime]::UtcNow -lt $deadline) {
    try {
      $response=Invoke-WebRequest -Uri ($Origin+'/api/health') -Method Get -SkipCertificateCheck -TimeoutSec 5
      $body=ConvertFrom-Json $response.Content
      if($body.status -eq 'ok' -and $body.mode -eq 'operational'){return}
    }catch{}
    Start-Sleep -Seconds 1
  }
  throw 'HOME_UAT_WEB_HEALTH_TIMEOUT'
}
function Assert-PortsAvailable {
  $ownProxy=Get-ServiceId 'proxy';$ownDb=Get-ServiceId 'db'
  foreach($port in @(19444,19445)) {
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    if($listeners.Count -gt 0) {
      $expected=if($port -eq 19444){$ownProxy}else{$ownDb}
      if(-not $expected){throw ('HOME_UAT_LOOPBACK_PORT_BUSY_'+$port)}
    }
  }
}
function Invoke-SeedPositiveJourney {
  $snapshot=Get-PersistenceSnapshot
  $caseCount=[int]($snapshot.Split('|')[0])
  if($caseCount -ne 0){throw 'HOME_UAT_PATIENT_DATA_ALREADY_EXISTS_SEED_NOT_RERUN'}
  $env:NIPT_MODE='operational'
  $env:APP_ORIGIN=$Origin
  $env:NIPT_OPERATIONAL_DATABASE='nipt_operational_home_uat'
  $env:NIPT_HOME_UAT_ACCOUNTS_FILE=Join-Path $Secrets 'uat-accounts.json'
  $env:NIPT_HOME_UAT_MIGRATION_URL_FILE=Join-Path $Secrets 'migration-url'
  $env:NIPT_HIS_SHARE_POLICY_FILE=Join-Path $LocalRoot 'integration\share-policy.json'
  $env:FILE_STORE_ROOT=Join-Path $LocalRoot 'files'
  $env:SIMULATOR_ROOT=Join-Path $LocalRoot 'integration'
  $env:SOURCE_REVISION=$env:SOURCE_REVISION
  $migrationUrl=(Get-Content -LiteralPath (Join-Path $Secrets 'migration-url') -Raw).Trim()
  $env:DATABASE_URL=$migrationUrl.Replace('@db:5432/','@127.0.0.1:19445/')
  Save-Checkpoint 'positive-journey-started' 'IN_PROGRESS'
  & node --import tsx (Join-Path $PSScriptRoot 'run-home-uat-positive-journey.ts')
  if($LASTEXITCODE -ne 0){Save-Checkpoint 'positive-journey' 'FAILED';throw 'HOME_UAT_POSITIVE_JOURNEY_FAILED'}
  Save-Checkpoint 'positive-journey-complete' 'PASS'
}

Set-ComposeContract
switch($Action) {
  'Start' {
    Set-ComposeContract -RequireClean
    Assert-PortsAvailable
    Initialize-LocalFiles
    Ensure-NativeBridge
    Save-Checkpoint 'native-excel-bridge-ready' 'PASS'
    Invoke-Compose @('up','-d','--build')
    Save-Checkpoint 'compose-started' 'PASS'
    Wait-QuickHealth
    $health=Get-HomeHealth
    if(-not $health.ready){Save-Checkpoint 'service-health' 'FAILED';throw 'HOME_UAT_START_NOT_READY'}
    Save-Checkpoint 'service-health' 'PASS'
    $health|ConvertTo-Json -Depth 8
  }
  'Stop' {
    Invoke-Compose @('stop')
    $bridgeStopped=Request-StopNativeBridge
    Save-Checkpoint 'stopped' $(if($bridgeStopped){'PASS'}else{'STOP_REQUESTED_EXPORT_MAY_FINISH'})
    [pscustomobject]@{compose='STOPPED';excelBridge=$(if($bridgeStopped){'STOPPED'}else{'FINISHING_CURRENT_EXPORT'});data='PRESERVED';volumes='PRESERVED'}|ConvertTo-Json
  }
  'Restart' {
    $before=Get-PersistenceSnapshot
    Ensure-NativeBridge
    Invoke-Compose @('restart','db','renderer','worker','web','proxy')
    Wait-QuickHealth
    $after=Get-PersistenceSnapshot
    if($before -ne $after){throw 'HOME_UAT_RESTART_PERSISTENCE_MISMATCH'}
    $health=Get-HomeHealth
    if(-not $health.ready){throw 'HOME_UAT_RESTART_NOT_READY'}
    Save-Checkpoint 'restart-persistence-verified' 'PASS'
    [pscustomobject]@{persistenceBefore=$before;persistenceAfter=$after;data='PRESERVED';ready=$health.ready;url=$health.url}|ConvertTo-Json
  }
  'Health' {
    Get-HomeHealth|ConvertTo-Json -Depth 8
  }
  'Logs' {
    Invoke-Compose @('logs','--tail','200','--follow')
  }
  'ListFixtures' {
    Get-Content -LiteralPath (Join-Path $LocalRoot 'fixtures\case-list.csv')
  }
  'StagePET' {
    if(-not $FixtureId){throw 'FIXTURE_ID_REQUIRED'}
    $env:NIPT_MODE='operational'
    $env:NIPT_HOME_UAT_FIXTURE_ROOT=Join-Path $LocalRoot 'fixtures'
    $env:NIPT_HOME_UAT_SIMULATOR_ROOT=Join-Path $LocalRoot 'integration'
    $env:NIPT_HOME_UAT_FIXTURE_ID=$FixtureId
    $env:NIPT_HOME_UAT_ROUND=[string]$Round
    & node --import tsx (Join-Path $PSScriptRoot 'stage-home-uat-pet.ts')
    if($LASTEXITCODE -ne 0){throw 'HOME_UAT_PET_SIMULATION_FAILED'}
  }
  'SeedPositiveJourney' {
    if(-not (Test-Path -LiteralPath $Secrets)){throw 'HOME_UAT_NOT_PROVISIONED'}
    Set-ComposeContract -RequireClean
    Ensure-NativeBridge
    Wait-QuickHealth
    Invoke-SeedPositiveJourney
    Get-HomeHealth|ConvertTo-Json -Depth 8
  }
}

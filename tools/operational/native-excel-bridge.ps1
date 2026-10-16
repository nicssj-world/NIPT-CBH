param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$ExportScript
)
$ErrorActionPreference='Stop'
$rootPath=[IO.Path]::GetFullPath($Root)
$exportPath=[IO.Path]::GetFullPath($ExportScript)
if($rootPath.StartsWith('\\') -or $exportPath.StartsWith('\\') -or -not (Test-Path -LiteralPath $exportPath -PathType Leaf)){throw 'LOCAL_EXCEL_BRIDGE_PATH_INVALID'}
$inbox=[IO.Path]::Combine($rootPath,'inbox')
$processing=[IO.Path]::Combine($rootPath,'processing')
$outbox=[IO.Path]::Combine($rootPath,'outbox')
$heartbeat=[IO.Path]::Combine($rootPath,'bridge-status.json')
$stopFile=[IO.Path]::Combine($rootPath,'stop.request')
foreach($directory in @($inbox,$processing,$outbox)){[IO.Directory]::CreateDirectory($directory)|Out-Null}
function Write-JsonAtomic([string]$Path,[object]$Value,[bool]$Overwrite=$false) {
  $temp=$Path+'.tmp'
  [IO.File]::WriteAllText($temp,($Value|ConvertTo-Json -Compress -Depth 5),[Text.UTF8Encoding]::new($false))
  if($Overwrite -and [IO.File]::Exists($Path)){[IO.File]::Move($temp,$Path,$true)}
  else{[IO.File]::Move($temp,$Path)}
}
function Set-BridgeStatus([string]$State) {
  Write-JsonAtomic $heartbeat @{state=$State;pid=$PID;updatedAt=[DateTime]::UtcNow.ToString('o')} $true
}
function Write-JobStatus([string]$Directory,[bool]$Ok,[string]$Code) {
  $status=[IO.Path]::Combine($Directory,'status.json')
  Write-JsonAtomic $status @{ok=$Ok;code=$Code;completedAt=[DateTime]::UtcNow.ToString('o')} $true
}
function Write-BridgeLog([string]$Message) {
  $line=[DateTime]::UtcNow.ToString('o')+' '+$Message+[Environment]::NewLine
  [IO.File]::AppendAllText([IO.Path]::Combine($rootPath,'bridge.log'),$line,[Text.UTF8Encoding]::new($false))
}
function Process-Request([string]$RequestPath) {
  $jobId=[IO.Path]::GetFileNameWithoutExtension($RequestPath)
  if($jobId -notmatch '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'){return}
  $processingPath=[IO.Path]::Combine($processing,$jobId+'.json')
  if($RequestPath.StartsWith($inbox,[StringComparison]::OrdinalIgnoreCase)){
    try{[IO.File]::Move($RequestPath,$processingPath)}catch{return}
  }else{$processingPath=$RequestPath}
  $output=[IO.Path]::Combine($outbox,$jobId)
  try {
    Set-BridgeStatus 'processing'
    $request=Get-Content -LiteralPath $processingPath -Raw|ConvertFrom-Json
    if($request.version -ne 1 -or $request.id -ne $jobId){throw 'LOCAL_EXCEL_REQUEST_INVALID'}
    $sheets=@($request.sheets|ForEach-Object{[int]$_})
    if($sheets.Count -lt 1 -or $sheets.Count -gt 6 -or @($sheets|Where-Object{$_ -lt 1 -or $_ -gt 6}).Count -gt 0 -or @($sheets|Select-Object -Unique).Count -ne $sheets.Count){throw 'LOCAL_EXCEL_SHEETS_INVALID'}
    $input=[IO.Path]::GetFullPath([IO.Path]::Combine($inbox,$jobId+'.xlsx'))
    if(-not $input.StartsWith($rootPath+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($input)){throw 'LOCAL_EXCEL_INPUT_MISSING'}
    $info=Get-Item -LiteralPath $input
    if($info.Length -lt 4 -or $info.Length -gt 20MB){throw 'LOCAL_EXCEL_INPUT_SIZE_INVALID'}
    $stream=[IO.File]::OpenRead($input);try{$first=$stream.ReadByte();$second=$stream.ReadByte()}finally{$stream.Dispose()}
    if($first -ne 0x50 -or $second -ne 0x4b){throw 'LOCAL_EXCEL_INPUT_INVALID'}
    if([IO.Directory]::Exists($output)){throw 'LOCAL_EXCEL_OUTPUT_ALREADY_EXISTS'}
    [IO.Directory]::CreateDirectory($output)|Out-Null
    & $exportPath -InputWorkbook $input -OutputDirectory $output -SheetIndices ($sheets -join ',')|Out-Null
    if(-not [IO.File]::Exists([IO.Path]::Combine($output,'native-manifest.json'))){throw 'LOCAL_EXCEL_MANIFEST_MISSING'}
    foreach($sheet in $sheets){$file=[IO.Path]::Combine($output,'sheet-'+$sheet+'.pdf');if(-not [IO.File]::Exists($file) -or (Get-Item -LiteralPath $file).Length -lt 5){throw 'LOCAL_EXCEL_PDF_MISSING'}}
    Write-JobStatus $output $true 'OK'
    Write-BridgeLog ($jobId+' COMPLETE')
  } catch {
    if([IO.Directory]::Exists($output)){try{Write-JobStatus $output $false 'TASK_NATIVE_EXCEL_FAILED'}catch{}}
    Write-BridgeLog ($jobId+' FAILED')
  } finally {
    if([IO.File]::Exists($processingPath)){[IO.File]::Delete($processingPath)}
    Set-BridgeStatus 'idle'
  }
}
Set-BridgeStatus 'idle'
Write-BridgeLog 'STARTED'
while($true) {
  if([IO.File]::Exists($stopFile)) {
    [IO.File]::Delete($stopFile)
    Set-BridgeStatus 'stopped'
    Write-BridgeLog 'STOPPED'
    break
  }
  $requests=@(Get-ChildItem -LiteralPath $inbox -Filter '*.json' -File -ErrorAction SilentlyContinue)+@(Get-ChildItem -LiteralPath $processing -Filter '*.json' -File -ErrorAction SilentlyContinue)
  foreach($request in $requests){Process-Request $request.FullName}
  Set-BridgeStatus 'idle'
  Start-Sleep -Milliseconds 500
}

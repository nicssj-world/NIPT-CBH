[CmdletBinding()]
param(
  [ValidateSet('Start','Stop','Status')]
  [string]$Action='Status'
)

$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$RepoRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$HomeScript=Join-Path $PSScriptRoot 'Home-UAT.ps1'
$LocalRoot=Join-Path $RepoRoot '.local\owner-local-uat-1.0.2'
$LastErrorFile=Join-Path $LocalRoot 'launcher-last-error.txt'
$ExpectedBranch='fix/consolidated-parity-101'
$Origin='https://127.0.0.1:19548'
$DesktopDocker='C:\Users\User\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe'
$MutexName='Local\NIPT-CBH-Owner-Local-UAT-102'

function Get-PwshPath {
  $command=Get-Command pwsh.exe -ErrorAction SilentlyContinue
  if(-not $command){throw 'PowerShell 7 is required.'}
  return $command.Source
}

function Get-GitInfo {
  $branch=(& git -C $RepoRoot branch --show-current 2>$null).Trim()
  if($LASTEXITCODE -ne 0){$branch='Unavailable'}
  $head=(& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
  if($LASTEXITCODE -ne 0){$head='Unavailable'}
  $dirty=@(& git -C $RepoRoot status --porcelain 2>$null).Count -gt 0
  return [pscustomobject]@{branch=$branch;head=$head;dirty=$dirty}
}

function Test-DockerReady {
  $docker=Get-Command docker.exe -ErrorAction SilentlyContinue
  if(-not $docker){return $false}
  & $docker.Source info --format '{{.ServerVersion}}' 2>$null | Out-Null
  return ($LASTEXITCODE -eq 0)
}

function Ensure-DockerReady([int]$TimeoutSeconds=240) {
  if(Test-DockerReady){return}
  if(-not (Test-Path -LiteralPath $DesktopDocker)){throw 'Docker Desktop is not installed or could not be found.'}
  Start-Process -FilePath $DesktopDocker -WindowStyle Hidden | Out-Null
  $deadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while([DateTime]::UtcNow -lt $deadline) {
    if(Test-DockerReady){return}
    Start-Sleep -Seconds 2
  }
  throw 'Docker Desktop did not become ready in time. Open Docker Desktop and try Start again.'
}

function Invoke-HomeAction([string]$HomeAction) {
  $pwsh=Get-PwshPath
  Push-Location -LiteralPath $RepoRoot
  try {
    $output=@(& $pwsh -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $HomeScript -Action $HomeAction 2>&1)
    $code=$LASTEXITCODE
    if($code -ne 0) {
      $details=($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
      if(-not $details.Trim()){$details="Home-UAT action '$HomeAction' failed (exit $code)."}
      throw $details.Trim()
    }
    return $output
  } finally {
    Pop-Location
  }
}

function Get-HomeHealth {
  $output=Invoke-HomeAction 'Health'
  $json=($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  try {return ($json | ConvertFrom-Json -ErrorAction Stop)}
  catch {throw 'The Local UAT health response could not be read.'}
}

function Get-ErrorText {
  if(Test-Path -LiteralPath $LastErrorFile){return (Get-Content -LiteralPath $LastErrorFile -Raw).Trim()}
  return 'None'
}

function Save-LastError([string]$Message) {
  New-Item -ItemType Directory -Path $LocalRoot -Force | Out-Null
  $safe=$Message -replace '[\r\n]+',' '
  [IO.File]::WriteAllText($LastErrorFile,$safe,[Text.UTF8Encoding]::new($false))
}

function Clear-LastError {
  if(Test-Path -LiteralPath $LastErrorFile){Remove-Item -LiteralPath $LastErrorFile -Force}
}

function Show-Notification([string]$Message,[bool]$Failed=$false) {
  try {
    $shell=New-Object -ComObject WScript.Shell
    $icon=if($Failed){48}else{64}
    [void]$shell.Popup($Message,8,'NIPT-CBH Local',$icon)
  } catch {
    Add-Type -AssemblyName System.Windows.Forms
    $icon=if($Failed){[System.Windows.Forms.MessageBoxIcon]::Warning}else{[System.Windows.Forms.MessageBoxIcon]::Information}
    [void][System.Windows.Forms.MessageBox]::Show($Message,'NIPT-CBH Local',[System.Windows.Forms.MessageBoxButtons]::OK,$icon)
  }
}

function Stop-ExcelBridgeSafely {
  $spool=Join-Path $LocalRoot 'excel-spool'
  $pidFile=Join-Path $spool 'bridge.launcher.pid'
  if(-not (Test-Path -LiteralPath $pidFile)){return $true}
  $savedPid=0
  [void][int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(),[ref]$savedPid)
  if($savedPid -le 0){return $true}
  $process=Get-Process -Id $savedPid -ErrorAction SilentlyContinue
  if(-not $process){return $true}
  $command=Get-CimInstance Win32_Process -Filter "ProcessId=$savedPid" -ErrorAction SilentlyContinue
  if(-not $command -or -not $command.CommandLine.Contains('native-excel-bridge.ps1') -or -not $command.CommandLine.Contains($spool)) {
    throw 'The Excel bridge PID does not match this Local UAT. It was left untouched.'
  }
  Set-Content -LiteralPath (Join-Path $spool 'stop.request') -Value 'stop' -NoNewline
  $deadline=[DateTime]::UtcNow.AddSeconds(20)
  while([DateTime]::UtcNow -lt $deadline) {
    if(-not (Get-Process -Id $savedPid -ErrorAction SilentlyContinue)){return $true}
    Start-Sleep -Milliseconds 300
  }
  return $false
}

function Start-LocalUat {
  $git=Get-GitInfo
  if($git.branch -ne $ExpectedBranch){throw "Expected branch '$ExpectedBranch'; found '$($git.branch)'. No services were started."}
  Ensure-DockerReady
  $health=$null
  if(Test-Path -LiteralPath $LocalRoot) {
    try {$health=Get-HomeHealth}catch{$health=$null}
  }
  if($health -and $health.ready -eq $true) {
    Clear-LastError
    Start-Process -FilePath ($Origin+'/login') | Out-Null
    Show-Notification 'NIPT-CBH Local เปิดอยู่แล้ว และได้เปิดหน้า Login ใน Browser แล้ว'
    return
  }
  [void](Invoke-HomeAction 'Start')
  $health=Get-HomeHealth
  if($health.ready -ne $true){throw 'Local UAT services did not pass the full readiness check.'}
  Start-Process -FilePath ($Origin+'/login') | Out-Null
  Clear-LastError
  Show-Notification 'NIPT-CBH Local พร้อมทดลองแล้ว และได้เปิดหน้า Login ใน Browser แล้ว'
}

function Stop-LocalUat {
  if(-not (Test-Path -LiteralPath $LocalRoot)) {
    Show-Notification 'NIPT-CBH Local ยังไม่เคยเริ่มใช้งาน จึงไม่มีบริการให้ปิด'
    return
  }
  $projectContainers=@()
  if(Test-DockerReady) {
    $projectContainers=@(& docker.exe ps -aq --filter 'label=com.docker.compose.project=nipt-cbh-owner-local-102-20261020')
    if($LASTEXITCODE -ne 0){throw 'Could not inspect only this Local UAT project.'}
    if($projectContainers.Count -gt 0) {
      $output=Invoke-HomeAction 'Stop'
      $stopResult=$null
      foreach($line in $output) {
        try {
          $candidate=([string]$line | ConvertFrom-Json -ErrorAction Stop)
          if($candidate.compose -eq 'STOPPED'){$stopResult=$candidate}
        } catch { }
      }
      if(-not $stopResult){throw 'Home-UAT did not confirm that its own Compose project stopped.'}
      if($stopResult.excelBridge -ne 'STOPPED') {
        Show-Notification 'บริการแอปปิดแล้ว แต่ Excel Bridge กำลังทำ Export ปัจจุบันให้เสร็จ โปรดรอสักครู่ก่อน Start ใหม่' $true
        return
      }
    } else {
      $bridgeStopped=Stop-ExcelBridgeSafely
      if(-not $bridgeStopped){throw 'Local UAT containers are stopped, but the Excel Bridge is still finishing an export.'}
    }
  } else {
    $bridgeStopped=Stop-ExcelBridgeSafely
    if(-not $bridgeStopped){throw 'Docker services are offline, but the Excel Bridge is still finishing an export.'}
    Show-Notification 'Docker Desktop ปิดอยู่ และบริการ NIPT-CBH Local หยุดแล้ว โดยหยุด Excel Bridge ของ Local UAT แล้ว'
    return
  }
  Show-Notification 'ปิดบริการ NIPT-CBH Local แล้ว ข้อมูล Database และไฟล์ทดลองยังคงอยู่'
}

function Get-ServiceDisplay([object]$Health,[string]$Name) {
  if(-not $Health -or -not $Health.services){return 'Stopped'}
  $property=$Health.services.PSObject.Properties[$Name]
  if(-not $property){return 'Stopped'}
  if(([string]$property.Value).StartsWith('running|')){return 'Running'}
  return 'Stopped'
}

function Show-StatusWindow([string]$Text,[bool]$Ready) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $form=New-Object System.Windows.Forms.Form
  $form.Text='NIPT-CBH Local Status'
  $form.StartPosition=[System.Windows.Forms.FormStartPosition]::CenterScreen
  $form.Size=[System.Drawing.Size]::new(740,510)
  $form.MinimumSize=[System.Drawing.Size]::new(640,430)
  $form.Font=[System.Drawing.Font]::new('Segoe UI',10)

  $layout=New-Object System.Windows.Forms.TableLayoutPanel
  $layout.Dock=[System.Windows.Forms.DockStyle]::Fill
  $layout.ColumnCount=1
  $layout.RowCount=2
  $layout.Padding=[System.Windows.Forms.Padding]::new(18)
  $layout.RowStyles.Add([System.Windows.Forms.RowStyle]::new([System.Windows.Forms.SizeType]::Percent,100)) | Out-Null
  $layout.RowStyles.Add([System.Windows.Forms.RowStyle]::new([System.Windows.Forms.SizeType]::Absolute,52)) | Out-Null

  $details=New-Object System.Windows.Forms.TextBox
  $details.Dock=[System.Windows.Forms.DockStyle]::Fill
  $details.Multiline=$true
  $details.ReadOnly=$true
  $details.WordWrap=$true
  $details.ScrollBars=[System.Windows.Forms.ScrollBars]::Vertical
  $details.BorderStyle=[System.Windows.Forms.BorderStyle]::FixedSingle
  $details.Font=[System.Drawing.Font]::new('Segoe UI',10)
  $details.Text=$Text
  [void]$layout.Controls.Add($details,0,0)

  $buttons=New-Object System.Windows.Forms.FlowLayoutPanel
  $buttons.Dock=[System.Windows.Forms.DockStyle]::Fill
  $buttons.FlowDirection=[System.Windows.Forms.FlowDirection]::RightToLeft
  $open=New-Object System.Windows.Forms.Button
  $open.Text='เปิด Local UAT'
  $open.AutoSize=$true
  $open.Enabled=$Ready
  $open.Add_Click({Start-Process -FilePath ($script:Origin+'/login') | Out-Null})
  $close=New-Object System.Windows.Forms.Button
  $close.Text='ปิดหน้าต่าง'
  $close.AutoSize=$true
  $close.Add_Click({$script:form.Close()})
  [void]$buttons.Controls.Add($close)
  [void]$buttons.Controls.Add($open)
  [void]$layout.Controls.Add($buttons,0,1)
  [void]$form.Controls.Add($layout)
  $script:form=$form
  [void]$form.ShowDialog()
}

function Show-LocalStatus {
  $git=Get-GitInfo
  $health=$null
  $dockerReady=Test-DockerReady
  if($dockerReady -and (Test-Path -LiteralPath $LocalRoot)) {
    try {$health=Get-HomeHealth}catch {Save-LastError $_.Exception.Message}
  }
  $overall=if(-not $dockerReady){'Docker Desktop is stopped'}elseif($health -and $health.ready -eq $true){'READY'}elseif(-not (Test-Path -LiteralPath $LocalRoot)){'NOT INITIALIZED'}else{'NOT READY'}
  $dirty=if($git.dirty){'Yes (local edits will be included on next Start)'}else{'No'}
  $text=@(
    'สถานะ Local Operational UAT สำหรับข้อมูลทดสอบเท่านั้น',
    '',
    'Application Version: 1.0.2 Baseline',
    ('Git branch / HEAD: {0} / {1}' -f $git.branch,$git.head),
    ('Uncommitted source edits: {0}' -f $dirty),
    ('Local URL: {0}/login' -f $Origin),
    ('PostgreSQL: {0}' -f (Get-ServiceDisplay $health 'db')),
    ('Web: {0}' -f (Get-ServiceDisplay $health 'web')),
    ('Worker: {0}' -f (Get-ServiceDisplay $health 'worker')),
    ('Renderer: {0}' -f (Get-ServiceDisplay $health 'renderer')),
    ('HTTPS: {0}' -f (Get-ServiceDisplay $health 'proxy')),
    ('Overall Health: {0}' -f $overall),
    ('Last Error: {0}' -f (Get-ErrorText))
  ) -join [Environment]::NewLine
  Show-StatusWindow $text ([bool]($health -and $health.ready -eq $true))
}

if(-not (Test-Path -LiteralPath $HomeScript)){throw 'Home-UAT runtime script is missing.'}
if($Action -eq 'Status') {
  Show-LocalStatus
  return
}

$mutex=[Threading.Mutex]::new($false,$MutexName)
$locked=$false
try {
  $locked=$mutex.WaitOne(0)
  if(-not $locked) {
    Show-Notification 'มีคำสั่ง Start หรือ Stop กำลังทำงานอยู่ กรุณารอแล้วลองอีกครั้ง' $true
    return
  }
  try {
    if($Action -eq 'Start'){Start-LocalUat}else{Stop-LocalUat}
  } catch {
    Save-LastError $_.Exception.Message
    Show-Notification ('ดำเนินการไม่สำเร็จ: '+$_.Exception.Message) $true
    exit 1
  }
} finally {
  if($locked){$mutex.ReleaseMutex()}
  $mutex.Dispose()
}

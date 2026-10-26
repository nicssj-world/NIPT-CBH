param([int]$Seconds=16)
$runtime=Get-Content '.local/task3-uat/runtime.json' -Raw | ConvertFrom-Json
$rootId=[int]$runtime.pids.renderer
$seen=@{}
$end=[DateTime]::UtcNow.AddSeconds($Seconds)
while([DateTime]::UtcNow -lt $end){
 $all=Get-CimInstance Win32_Process
 $desc=@($rootId)
 for($depth=0;$depth -lt 6;$depth++){$children=@($all | Where-Object {$_.ParentProcessId -in $desc} | ForEach-Object {[int]$_.ProcessId});$desc=@($desc+$children | Select-Object -Unique)}
 foreach($p in $all | Where-Object {$_.ProcessId -in $desc}){
  $proc=Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
  $key=[string]$p.ProcessId
  if(-not $seen.ContainsKey($key)){$seen[$key]=[ordered]@{pid=$p.ProcessId;parent=$p.ParentProcessId;name=$p.Name;visibleWindow=$false}}
  if($proc -and $proc.MainWindowHandle -ne 0){$seen[$key].visibleWindow=$true}
 }
 Start-Sleep -Milliseconds 200
}
$observed=@($seen.Values)
$result=[ordered]@{rendererPid=$rootId;buildId=$runtime.buildId;durationSeconds=$Seconds;observed=$observed;consoleDescendants=@($observed | Where-Object {$_.name -in 'cmd.exe','conhost.exe','powershell.exe','pwsh.exe'});visibleWindows=@($observed | Where-Object {$_.visibleWindow});limitation='Process-window sampling, not a physical Owner desktop observation'}
$result | ConvertTo-Json -Depth 6 | Set-Content docs/anc-owner-uat-20261025/pdf-process-window.json

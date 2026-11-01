param([Parameter(Mandatory=$true)][string]$Manifest)
# Microsoft Word renders the filled Owner masters to PDF, as ReadyGen itself does through Word interop.
# One private automation instance per call, documents opened read-only with macros forced off, no user document touched.
$ErrorActionPreference='Stop'
$manifestPath=[IO.Path]::GetFullPath($Manifest)
if($manifestPath.StartsWith('\\')){throw 'NETWORK_PATH_PROHIBITED'}
$items=@(Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json)
if($items.Count -lt 1 -or $items.Count -gt 200){throw 'REPORT_BATCH_SIZE_INVALID'}
$word=$null
$ownPid=$null
$mutex=New-Object Threading.Mutex($false,'Local\NiptCbhNativeWordExport')
$locked=$false
$results=@()
# The automation instance this call starts: the single WINWORD.exe that is new, in this session, and was started by COM (/Automation).
# Anything ambiguous is left alone: a user's own Word is never touched.
function Get-OwnWordPid([int[]]$Before){
  $session=(Get-Process -Id $PID).SessionId
  $new=@(Get-CimInstance Win32_Process -Filter "Name='WINWORD.EXE'" -ErrorAction SilentlyContinue | Where-Object { $Before -notcontains [int]$_.ProcessId -and $_.SessionId -eq $session -and [string]$_.CommandLine -match '/Automation' })
  if($new.Count -eq 1){[int]$new[0].ProcessId}else{$null}
}
try {
  $locked=$mutex.WaitOne(180000)
  if(-not $locked){throw 'REPORT_WORD_EXPORT_BUSY'}
  $before=@(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $word=New-Object -ComObject Word.Application
  $ownPid=Get-OwnWordPid $before
  # the caller kills exactly this instance if this script is stopped by its timeout (packages/readygen/native-word.ts)
  if($ownPid -and $env:NIPT_OFFICE_PID_FILE){Set-Content -LiteralPath $env:NIPT_OFFICE_PID_FILE -Value $ownPid -Encoding ascii}
  $word.Visible=$false
  $word.DisplayAlerts=0
  $word.AutomationSecurity=3
  $word.Options.UpdateLinksAtOpen=$false
  foreach($item in $items){
    $source=[IO.Path]::GetFullPath([string]$item.input)
    $target=[IO.Path]::GetFullPath([string]$item.output)
    if($source.StartsWith('\\') -or $target.StartsWith('\\')){throw 'NETWORK_PATH_PROHIBITED'}
    if(Test-Path -LiteralPath $target){throw 'REPORT_PDF_DESTINATION_EXISTS'}
    $doc=$null
    try {
      # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles); the remaining arguments keep Word's defaults.
      $doc=$word.Documents.Open($source,$false,$true,$false)
      $pages=$doc.ComputeStatistics(2)
      # 17 = wdExportFormatPDF, OptimizeFor 0 = print, Range 0 = whole document, Item 0 = content only, BitmapMissingFonts.
      $doc.ExportAsFixedFormat($target,17,$false,0,0,0,0,0,$false,$true,0,$true,$true,$false)
      $results+=@{id=[string]$item.id;pages=$pages;output=$target}
    } finally {
      if($null -ne $doc){$doc.Close(0);[Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc)|Out-Null}
    }
  }
  $results|ConvertTo-Json -Depth 3 -Compress|Set-Content -LiteralPath ($manifestPath+'.result.json') -Encoding utf8
} finally {
  try {
    try {if($null -ne $word){$word.Quit(0);[Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)|Out-Null}}
    finally {
      # a Quit that does not end the process (a hidden dialog, a stuck add-in) must not leave an instance that the next export attaches to
      $word=$null;[GC]::Collect();[GC]::WaitForPendingFinalizers()
      if($ownPid -and (Get-Process -Id $ownPid -ErrorAction SilentlyContinue)){
        Wait-Process -Id $ownPid -Timeout 15 -ErrorAction SilentlyContinue
        if(Get-Process -Id $ownPid -ErrorAction SilentlyContinue){Stop-Process -Id $ownPid -Force -ErrorAction SilentlyContinue;[Console]::Error.WriteLine("REPORT_WORD_INSTANCE_FORCED_EXIT pid=$ownPid")}
      }
    }
  }
  finally {if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}
}

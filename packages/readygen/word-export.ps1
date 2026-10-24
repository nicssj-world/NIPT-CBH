param([Parameter(Mandatory=$true)][string]$Manifest)
# Microsoft Word renders the filled Owner masters to PDF, as ReadyGen itself does through Word interop.
# One private automation instance per call, documents opened read-only with macros forced off, no user document touched.
$ErrorActionPreference='Stop'
$manifestPath=[IO.Path]::GetFullPath($Manifest)
if($manifestPath.StartsWith('\\')){throw 'NETWORK_PATH_PROHIBITED'}
$items=@(Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json)
if($items.Count -lt 1 -or $items.Count -gt 200){throw 'REPORT_BATCH_SIZE_INVALID'}
$word=$null
$mutex=New-Object Threading.Mutex($false,'Local\NiptCbhNativeWordExport')
$locked=$false
$results=@()
try {
  $locked=$mutex.WaitOne(180000)
  if(-not $locked){throw 'REPORT_WORD_EXPORT_BUSY'}
  $word=New-Object -ComObject Word.Application
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
  try {if($null -ne $word){$word.Quit(0);[Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)|Out-Null}}
  finally {if($locked){$mutex.ReleaseMutex()};$mutex.Dispose()}
}

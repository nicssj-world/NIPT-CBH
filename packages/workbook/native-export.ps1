param([Parameter(Mandatory=$true)][string]$InputWorkbook,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath($InputWorkbook)
$destination=[IO.Path]::GetFullPath($OutputDirectory)
if(-not (Test-Path -LiteralPath $source -PathType Leaf)){throw 'TASK_WORKBOOK_NOT_FOUND'}
if($source.StartsWith('\\') -or $destination.StartsWith('\\')){throw 'NETWORK_PATH_PROHIBITED'}
[IO.Directory]::CreateDirectory($destination)|Out-Null
$excel=$null
$book=$null
$printerName=$null
$printerSnapshot=$null
$exportMutex=New-Object Threading.Mutex($false,'Local\NiptCbhNativeExcelExport')
$exportLock=$false
try {
  $exportLock=$exportMutex.WaitOne(120000)
  if(-not $exportLock){throw 'TASK_EXCEL_EXPORT_BUSY'}
  # Excel's PDF engine takes its physical media from the active printer DEVMODE.
  # This master stores A4=9 but its Adobe private DEVMODE retains Letter width/height.
  # Reconcile the DRIVER to the locked A4 contract, never workbook PageSetup or scaling.
  $printerDevice=(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows' -Name Device).Device
  $printerName=$printerDevice.Split(',')[0]
  $printerSnapshot=Get-PrintConfiguration -PrinterName $printerName
  Set-PrintConfiguration -PrinterName $printerName -PaperSize A4
  # A separate automation instance never attaches to a user's existing workbook session.
  $excel=New-Object -ComObject Excel.Application
  $excel.Visible=$false
  $excel.DisplayAlerts=$false
  $excel.EnableEvents=$false
  $excel.AskToUpdateLinks=$false
  $excel.AutomationSecurity=3
  $book=$excel.Workbooks.Open($source,0,$true)
  $excel.CalculateFullRebuild()
  $manifest=@()
  for($index=1;$index -le $book.Worksheets.Count;$index++) {
    $sheet=$book.Worksheets.Item($index)
    $target=[IO.Path]::Combine($destination,"sheet-$index.pdf")
    if(Test-Path -LiteralPath $target){throw 'TASK_PDF_DESTINATION_EXISTS'}
    # Honor the template's print areas, margins, fonts, scaling and page breaks.
    $sheet.ExportAsFixedFormat(0,$target,0,$true,$false)
    $formulaCount=0
    $formulaErrors=@()
    foreach($cell in $sheet.UsedRange.Cells){
      if($cell.HasFormula){$formulaCount++;if($cell.Text -match '^#(REF!|DIV/0!|VALUE!|N/A|NAME\?|NUM!|NULL!)$'){$formulaErrors+=@{cell=$cell.Address();error=$cell.Text}}}
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($cell)|Out-Null
    }
    $manifest+=@{index=$index;sheet=$sheet.Name;file=$target;formulaCount=$formulaCount;formulaErrors=$formulaErrors;paperSize=$sheet.PageSetup.PaperSize;zoom=$sheet.PageSetup.Zoom;fitToPagesWide=$sheet.PageSetup.FitToPagesWide;fitToPagesTall=$sheet.PageSetup.FitToPagesTall;printArea=$sheet.PageSetup.PrintArea}
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet)|Out-Null
  }
  $manifest|ConvertTo-Json -Depth 4|Set-Content -LiteralPath ([IO.Path]::Combine($destination,'native-manifest.json')) -Encoding utf8
  $manifest|ConvertTo-Json -Depth 4 -Compress
} finally {
  try {
    try {if($null -ne $book){$book.Close($false);[Runtime.InteropServices.Marshal]::FinalReleaseComObject($book)|Out-Null}}
    finally {if($null -ne $excel){$excel.Quit();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)|Out-Null}}
  } finally {
    try {if($null -ne $printerSnapshot){Set-PrintConfiguration -PrinterName $printerName -PrintTicketXml $printerSnapshot.PrintTicketXML}}
    finally {if($exportLock){$exportMutex.ReleaseMutex()};$exportMutex.Dispose()}
  }
}

param([Parameter(Mandatory=$true)][string]$InputWorkbook,[Parameter(Mandatory=$true)][string]$OutputDirectory,[string]$SheetIndices='1,2,3,4,5,6')
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath($InputWorkbook)
$destination=[IO.Path]::GetFullPath($OutputDirectory)
if(-not (Test-Path -LiteralPath $source -PathType Leaf)){throw 'TASK_WORKBOOK_NOT_FOUND'}
if($source.StartsWith('\\') -or $destination.StartsWith('\\')){throw 'NETWORK_PATH_PROHIBITED'}
[IO.Directory]::CreateDirectory($destination)|Out-Null
$excel=$null
$ownPid=$null
$book=$null
$printerName=$null
$printerSnapshot=$null
$exportMutex=New-Object Threading.Mutex($false,'Local\NiptCbhNativeExcelExport')
$exportLock=$false
$selected=@($SheetIndices.Split(',')|ForEach-Object{[int]$_})
if($selected.Count -lt 1 -or @($selected|Where-Object{$_ -lt 1 -or $_ -gt 6}).Count){throw 'TASK_SHEET_REQUIRED'}
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
  # This instance's process, from its own window handle: the only Excel this script may ever force to exit.
  if(-not ('NiptCbh.Win32Window' -as [type])){Add-Type -Namespace NiptCbh -Name Win32Window -MemberDefinition '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);'}
  $ownPidValue=[uint32]0;[void][NiptCbh.Win32Window]::GetWindowThreadProcessId([IntPtr]$excel.Hwnd,[ref]$ownPidValue)
  if($ownPidValue -gt 0){$ownPid=[int]$ownPidValue;if($env:NIPT_OFFICE_PID_FILE){Set-Content -LiteralPath $env:NIPT_OFFICE_PID_FILE -Value $ownPid -Encoding ascii}}
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
    # A copied source may retain selected tabs. Excel exports the entire selected
    # group even through Worksheet.ExportAsFixedFormat; select this sheet alone.
    if($selected -contains $index){$sheet.Select($true);$sheet.ExportAsFixedFormat(0,$target,0,$true,$false)}
    $formulaCount=0
    $formulaErrors=@()
    foreach($cell in $sheet.UsedRange.Cells){
      if($cell.HasFormula){$formulaCount++;if($cell.Text -match '^#(REF!|DIV/0!|VALUE!|N/A|NAME\?|NUM!|NULL!)$'){$formulaErrors+=@{cell=$cell.Address();error=$cell.Text}}}
      [Runtime.InteropServices.Marshal]::FinalReleaseComObject($cell)|Out-Null
    }
    $poolingCalculation=$null
    if($index -eq 5){$poolingCalculation=@{D52=$sheet.Range('D52').Value2;F52=$sheet.Range('F52').Value2;D55=$sheet.Range('D55').Value2;F52Formula=$sheet.Range('F52').Formula;D55Formula=$sheet.Range('D55').Formula}}
    $manifest+=@{index=$index;sheet=$sheet.Name;file=$target;formulaCount=$formulaCount;formulaErrors=$formulaErrors;poolingCalculation=$poolingCalculation;paperSize=$sheet.PageSetup.PaperSize;zoom=$sheet.PageSetup.Zoom;fitToPagesWide=$sheet.PageSetup.FitToPagesWide;fitToPagesTall=$sheet.PageSetup.FitToPagesTall;printArea=$sheet.PageSetup.PrintArea}
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet)|Out-Null
  }
  $manifest|ConvertTo-Json -Depth 4|Set-Content -LiteralPath ([IO.Path]::Combine($destination,'native-manifest.json')) -Encoding utf8
  $manifest|ConvertTo-Json -Depth 4 -Compress
} finally {
  try {
    try {if($null -ne $book){$book.Close($false);[Runtime.InteropServices.Marshal]::FinalReleaseComObject($book)|Out-Null}}
    finally {
      try {if($null -ne $excel){$excel.Quit();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)|Out-Null}}
      finally {
        # a Quit that does not end the process must not leave a hidden Excel behind for the next export
        $excel=$null;[GC]::Collect();[GC]::WaitForPendingFinalizers()
        if($ownPid -and (Get-Process -Id $ownPid -ErrorAction SilentlyContinue)){
          Wait-Process -Id $ownPid -Timeout 15 -ErrorAction SilentlyContinue
          if(Get-Process -Id $ownPid -ErrorAction SilentlyContinue){Stop-Process -Id $ownPid -Force -ErrorAction SilentlyContinue;[Console]::Error.WriteLine("TASK_EXCEL_INSTANCE_FORCED_EXIT pid=$ownPid")}
        }
      }
    }
  } finally {
    try {if($null -ne $printerSnapshot){Set-PrintConfiguration -PrinterName $printerName -PrintTicketXml $printerSnapshot.PrintTicketXML}}
    finally {if($exportLock){$exportMutex.ReleaseMutex()};$exportMutex.Dispose()}
  }
}

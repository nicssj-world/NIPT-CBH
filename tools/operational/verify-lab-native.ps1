param([Parameter(Mandatory=$true)][string]$Workbook,[Parameter(Mandatory=$true)][string]$Evidence)
$ErrorActionPreference='Stop'
$excel=$null;$book=$null
try{
 $excel=New-Object -ComObject Excel.Application
 $excel.Visible=$false;$excel.DisplayAlerts=$false;$excel.EnableEvents=$false;$excel.AutomationSecurity=3
 $book=$excel.Workbooks.Open([IO.Path]::GetFullPath($Workbook),0,$true)
 $excel.CalculateFullRebuild()
 $qc=$book.Worksheets.Item(4);$pool=$book.Worksheets.Item(5)
 $rows=@()
 for($slot=1;$slot -le 48;$slot++){
  $rows+=@{slot=$slot;sampleId=$pool.Range('A'+($slot+7)).Value2;concentration=$qc.Range('C'+($slot+6)).Value2;volume=$pool.Range('B'+($slot+7)).Value2}
 }
 $dates=@()
 for($index=1;$index -le 3;$index++){
  $sheet=$book.Worksheets.Item($index)
  $dates+=@{sheet=$index;captionColor=$sheet.Range('A4').Font.Color;captionBold=$sheet.Range('A4').Font.Bold;value=$sheet.Range('B4').Value2;valueColor=$sheet.Range('B4').Font.Color;valueBold=$sheet.Range('B4').Font.Bold}
  [Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet)|Out-Null
 }
 $result=@{engine='Microsoft Excel';rows=$rows;dates=$dates;total=$pool.Range('C8').Value2;desired=$pool.Range('C10').Value2;buffer=$pool.Range('C12').Value2;v1=$pool.Range('F52').Value2;eb=$pool.Range('D55').Value2}
 [IO.File]::WriteAllText([IO.Path]::GetFullPath($Evidence),($result|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
 [Runtime.InteropServices.Marshal]::FinalReleaseComObject($qc)|Out-Null
 [Runtime.InteropServices.Marshal]::FinalReleaseComObject($pool)|Out-Null
 Write-Output 'Native Excel formula and work-date evidence saved.'
}finally{
 if($book){$book.Close($false);[Runtime.InteropServices.Marshal]::FinalReleaseComObject($book)|Out-Null}
 if($excel){$excel.Quit();[Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)|Out-Null}
}

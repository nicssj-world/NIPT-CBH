# Focused native regression: pwsh -NoProfile -File tests/native/workbook-formula-evidence.ps1
# Requires Windows, Excel and a local printer, like the native export itself.
# All workbook data and output are synthetic, under .local/dev only.
$ErrorActionPreference='Stop'
$repoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$testRoot=Join-Path $repoRoot ('.local/dev/runs/native-formulas-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$inputFile=Join-Path $testRoot 'synthetic.xlsx'
$excelVerify=$null
$verifyBook=$null
try {
 $excelVerify=New-Object -ComObject Excel.Application
 $excelVerify.Visible=$false
 $excelVerify.DisplayAlerts=$false
 $verifyBook=$excelVerify.Workbooks.Add(-4167) # xlWBATWorksheet: exactly one initial sheet
 while($verifyBook.Worksheets.Count -lt 6){[void]$verifyBook.Worksheets.Add()}
 for($index=1;$index -le 6;$index++){
  $sheet=$verifyBook.Worksheets.Item($index)
  try {
   $sheet.Range('A1:M160').Value2='SYNTHETIC'
   $sheet.PageSetup.PrintArea='$A$1:$M$50'
   if($index -le 5){
    $lastRow=if($index -eq 5){30}else{31}
    $sheet.Range("B2:B$lastRow").Formula='=1+1'
    $sheet.Range('B3').Formula='=1/0'
    $sheet.Range('B4').Formula='=NA()'
   }
  } finally {[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet)}
 }
 $verifyBook.SaveAs($inputFile,51)
} finally {
 try {if($verifyBook){$verifyBook.Close($false);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($verifyBook)}}
 finally {if($excelVerify){$excelVerify.Quit();[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excelVerify)};[GC]::Collect();[GC]::WaitForPendingFinalizers()}
}
$outputDir=Join-Path $testRoot 'output'
$timer=[Diagnostics.Stopwatch]::StartNew()
& (Join-Path $repoRoot 'packages/workbook/native-export.ps1') -InputWorkbook $inputFile -OutputDirectory $outputDir -SheetIndices '1' | Out-Null
$timer.Stop()
$manifest=Get-Content (Join-Path $outputDir 'native-manifest.json') -Raw | ConvertFrom-Json
if($manifest.Count -ne 6 -or ($manifest | Measure-Object formulaCount -Sum).Sum -ne 149){throw 'FORMULA_COUNT_CHANGED'}
for($index=0;$index -lt 6;$index++){
 $entry=$manifest[$index]
 $expectedCount=if($index -lt 4){30}elseif($index -eq 4){29}else{0}
 if($entry.formulaCount -ne $expectedCount){throw "SHEET_FORMULA_COUNT_CHANGED index=$index"}
 $expectedErrors=if($index -lt 5){2}else{0}
 if(@($entry.formulaErrors).Count -ne $expectedErrors){throw "FORMULA_ERROR_COUNT_CHANGED index=$index"}
 if($index -lt 5){
  if(@($entry.formulaErrors | Where-Object {$_.cell -eq '$B$3' -and $_.error -eq '#DIV/0!'}).Count -ne 1){throw 'DIVISION_ERROR_EVIDENCE_LOST'}
  if(@($entry.formulaErrors | Where-Object {$_.cell -eq '$B$4' -and $_.error -eq '#N/A'}).Count -ne 1){throw 'NA_ERROR_EVIDENCE_LOST'}
 }
 if($entry.printArea -ne '$A$1:$M$50'){throw 'PRINT_AREA_CHANGED'}
}
if(-not (Test-Path -LiteralPath (Join-Path $outputDir 'sheet-1.pdf'))){throw 'SELECTED_PDF_MISSING'}
if(Test-Path -LiteralPath (Join-Path $outputDir 'sheet-2.pdf')){throw 'UNSELECTED_SHEET_EXPORTED'}
[pscustomobject]@{pass=$true;formulaCount=149;formulaFreeSheetChecked=$true;errorsChecked=10;elapsedMs=$timer.ElapsedMilliseconds;evidence=$testRoot}|ConvertTo-Json

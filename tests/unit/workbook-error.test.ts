import {describe,expect,it} from 'vitest';
import {workbookError} from '../../src/server/workbook';

describe('native Excel renderer errors',()=>{
 it('reports denied local printer access as a renderer prerequisite failure without exposing stderr',async()=>{
  const error=Object.assign(new Error('Command failed: pwsh.exe packages/workbook/native-export.ps1'),{
   stderr:'Get-PrintConfiguration: packages/workbook/native-export.ps1:24\nAccess denied'
  });
  const response=workbookError(error),body=await response.json();
  expect(response.status).toBe(503);
  expect(body).toMatchObject({code:'TASK_NATIVE_EXCEL_PRINTER_ACCESS_DENIED'});
  expect(body.error).toContain('สิทธิ์อ่านการตั้งค่าเครื่องพิมพ์');
  expect(JSON.stringify(body)).not.toContain('Access denied');
  expect(JSON.stringify(body)).not.toContain('native-export.ps1');
 });
});

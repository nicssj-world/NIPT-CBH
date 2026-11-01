import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stopOwnOfficeInstance} from '../../packages/workbook/office-instance';

// Timeout cleanup of a native export may stop ONLY the Office instance that export recorded, and only while that PID is still Office.
let dir:string;
beforeAll(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'nipt-office-pid-'));});
afterAll(async()=>{await rm(dir,{recursive:true,force:true});});

describe('stopOwnOfficeInstance',()=>{
 it('does nothing when the export never recorded an instance',async()=>{
  expect(await stopOwnOfficeInstance(path.join(dir,'missing.pid'),'WINWORD.EXE')).toBeNull();
 });
 it('ignores an unreadable or non-numeric PID',async()=>{
  for(const [name,text] of [['empty.pid',''],['text.pid','not-a-pid'],['negative.pid','-4'],['fraction.pid','12.5']]){
   const f=path.join(dir,name);await writeFile(f,text);
   expect(await stopOwnOfficeInstance(f,'EXCEL.EXE')).toBeNull();
  }
 });
 it('never stops a process that is not the expected Office executable (a reused PID): this test process survives',async()=>{
  const f=path.join(dir,'self.pid');await writeFile(f,String(process.pid));
  expect(await stopOwnOfficeInstance(f,'WINWORD.EXE')).toBeNull();
  expect(await stopOwnOfficeInstance(f,'EXCEL.EXE')).toBeNull();
  expect(()=>process.kill(process.pid,0)).not.toThrow();
 });
});

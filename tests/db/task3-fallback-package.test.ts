import {it,expect,vi} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {task3Fixture} from '../helpers/task3';
import {fallbackPackage} from '../../packages/readygen/fallback-package';
import {readNiftyRequestRows} from '../../packages/readygen/halos-adapter';
import {readArchive,sha256} from '../../packages/workbook/archive';

it('outage package: exact vendor files, ReadyGen input with only J/O swapped, offline-verifiable manifest, audited and permission-checked',async()=>{
 const f=await task3Fixture();const dir=await mkdtemp(path.join(os.tmpdir(),'nipt-fallback-'));try{
  const deps={master:readFileSync(process.env.NIPT_TASK_MASTER_PATH!),store:f.store,render:async()=>{throw Error('NO_RENDER');}};
  const pkg=await f.run(t=>fallbackPackage(t,f.u.staff,f.pair.id,deps));
  const parts=readArchive(pkg.bytes),manifest=JSON.parse(parts.get('manifest.json')!.toString('utf8'));
  expect(manifest.schema).toBe('NIPT-CBH-READYGEN-FALLBACK-1');expect([...parts.keys()].sort()).toEqual(['HALOS-Task-Import.xlsx','NIFTY-readygen-input.xlsx','NIFTY-vendor.xlsx','README-TH-EN.txt','Verify-Package.ps1','manifest.json']);
  for(const file of manifest.files)expect(sha256(parts.get(file.name)!)).toBe(file.sha256);
  // Vendor export and HALOS task file are byte-identical to the frozen export records.
  const nifty=f.pair.files.find(x=>x.kind==='NIFTY_XLSX')!,halos=f.pair.files.find(x=>x.kind==='HALOS_TASK_XLSX')!;
  expect(sha256(parts.get('NIFTY-vendor.xlsx')!)).toBe(nifty.sha256);expect(sha256(parts.get('HALOS-Task-Import.xlsx')!)).toBe(halos.sha256);
  // ReadyGen copy: identical rows; J and O swapped in every patient row; every other cell unchanged.
  const vendor=readNiftyRequestRows(parts.get('NIFTY-vendor.xlsx')!),input=readNiftyRequestRows(parts.get('NIFTY-readygen-input.xlsx')!);
  expect(input.map(r=>r.sampleKey)).toEqual(vendor.map(r=>r.sampleKey));expect(vendor).toHaveLength(f.cases.length+2);
  for(const [i,v] of vendor.entries()){const r=input[i];expect(r.cells.J??'').toBe(v.cells.O??'');expect(r.cells.O??'').toBe(v.cells.J??'');
   for(const k of Object.keys(v.cells).filter(k=>!['J','O'].includes(k)))expect(r.cells[k]).toBe(v.cells[k]);}
  for(const c of f.cases){const r=input.find(x=>x.sampleKey===c.vendorId)!;expect(r.cells.J).toBe(c.hn);expect(r.cells.O).toBe(c.ln);}
  expect(manifest.readygenSwappedRows).toBe(f.cases.length);
  // Offline verification with Windows PowerShell only (no server), then a tampered file is detected.
  for(const [n,b] of parts)await writeFile(path.join(dir,n),b);
  const verify=()=>execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(dir,'Verify-Package.ps1')],{encoding:'utf8',windowsHide:true});
  expect(verify()).toContain('PACKAGE VERIFIED');
  await writeFile(path.join(dir,'HALOS-Task-Import.xlsx'),Buffer.from('tampered'));
  let failure:{status?:number;stdout?:string}={};try{verify();}catch(e){failure=e as typeof failure;}
  expect(failure.status).toBe(1);expect(failure.stdout).toContain('MISMATCH HALOS-Task-Import.xlsx');expect(failure.stdout).toContain('PACKAGE INVALID');
  expect((await f.db.query("SELECT 1 FROM audit_chain WHERE action='READYGEN_FALLBACK_PACKAGE_DOWNLOADED' AND resource_id=$1",[f.pair.id])).rows).toHaveLength(1);
  await expect(f.run(t=>fallbackPackage(t,f.u.anc,f.pair.id,deps))).rejects.toThrow();
 }finally{vi.unstubAllEnvs();await f.close();await rm(dir,{recursive:true,force:true});}
},240000);

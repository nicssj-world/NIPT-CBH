import {describe,it,expect,afterEach} from 'vitest';
import {mkdtemp,readdir,readFile,writeFile,mkdir,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {renderDocxBatch} from '../../packages/readygen/native-word';

// Owner 2026-11-10: the installed web process cannot start Word, so it hands .docx files to the owner's-session bridge through the spool folder.
// A stand-in bridge here answers the same protocol (tools/operational/native-excel-bridge.ps1): <id>.json request, <id>-<n>.docx inputs,
// outbox/<id>/<n>.pdf + manifest.json.result.json + status.json.
const PDF=Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
let spool='';
afterEach(async()=>{delete process.env.NIPT_NATIVE_EXCEL_SPOOL;if(spool)await rm(spool,{recursive:true,force:true});spool='';});
async function bridge(ok:boolean,code?:string){
 const inbox=path.join(spool,'inbox'),outbox=path.join(spool,'outbox');
 for(let i=0;i<200;i++){
  const requests=(await readdir(inbox).catch(()=>[] as string[])).filter(f=>f.endsWith('.json'));
  if(requests.length){
   const req=JSON.parse(await readFile(path.join(inbox,requests[0]),'utf8')) as {id:string;kind:string;count:number};
   const out=path.join(outbox,req.id);await mkdir(out,{recursive:true});
   if(ok){for(let n=0;n<req.count;n++)await writeFile(path.join(out,`${n}.pdf`),PDF);
    await writeFile(path.join(out,'manifest.json.result.json'),JSON.stringify(Array.from({length:req.count},(_,n)=>({id:String(n),pages:n+1}))));
    await writeFile(path.join(out,'status.json.tmp'),JSON.stringify({ok:true,code:'OK'}));}
   else await writeFile(path.join(out,'status.json.tmp'),JSON.stringify({ok:false,code}));
   await rename(path.join(out,'status.json.tmp'),path.join(out,'status.json'));return req;
  }
  await new Promise(r=>setTimeout(r,25));
 }
 throw new Error('no request');
}
describe('Word rendering through the host spool',()=>{
 it('sends a word request with the documents and returns the PDFs and page counts, then cleans up',async()=>{
  spool=await mkdtemp(path.join(tmpdir(),'nipt-spool-'));process.env.NIPT_NATIVE_EXCEL_SPOOL=spool;
  const docx=(s:string)=>Buffer.concat([Buffer.from([0x50,0x4b]),Buffer.from(s)]);
  const seen=bridge(true);
  const out=await renderDocxBatch([{id:'a',docx:docx('one')},{id:'b',docx:docx('two')}]);
  const req=await seen;
  expect(req.kind).toBe('word');expect(req.count).toBe(2);
  expect(out.map(o=>[o.id,o.pages,o.renderer])).toEqual([['a',1,'Microsoft Word'],['b',2,'Microsoft Word']]);
  expect(out[0].bytes.subarray(0,5).toString()).toBe('%PDF-');
  expect(await readdir(path.join(spool,'inbox'))).toEqual([]);expect(await readdir(path.join(spool,'outbox'))).toEqual([]);
 },20000);
 it('a bridge failure surfaces its code, not free text',async()=>{
  spool=await mkdtemp(path.join(tmpdir(),'nipt-spool-'));process.env.NIPT_NATIVE_EXCEL_SPOOL=spool;
  const seen=bridge(false,'REPORT_NATIVE_WORD_FAILED');
  await expect(renderDocxBatch([{id:'a',docx:Buffer.concat([Buffer.from([0x50,0x4b]),Buffer.from('xx')])}])).rejects.toThrow('REPORT_NATIVE_WORD_FAILED');
  await seen;
 },20000);
 it('refuses an oversize document before anything is written',async()=>{
  spool=await mkdtemp(path.join(tmpdir(),'nipt-spool-'));process.env.NIPT_NATIVE_EXCEL_SPOOL=spool;
  await expect(renderDocxBatch([{id:'a',docx:Buffer.alloc(21*1024*1024)}])).rejects.toThrow('REPORT_NATIVE_WORD_SPOOL_INVALID');
  expect(await readdir(spool)).toEqual([]);
 });
});

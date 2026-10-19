/** HIS outbound file verifier (read-only). For hospital IT acceptance and for the installed rehearsal: checks the RES / PDF / OK files in an
 *  outbound folder against the existing frozen wire contract (packages/integrations/res.ts, packages/p6/res.ts) and, when a database URL file is
 *  given, that no transfer is reported as HIS-confirmed. Reports field values so a receiver-side reviewer can compare them; it never modifies anything.
 *    tsx tools/win-installer/his-outbound-verify.ts --dir <outbound root with res\ pdf\ backup\> [--database-url-file <file>] [--out <report.json>]
 *  A passing report means "the files we wrote match our contract". It does NOT mean the HIS accepted anything (Q-I3/Q-I4/Q-I5 remain open). */
import {readdir,readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {verifyRes,resFilename} from '../../packages/integrations/res';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:process.argv[i+1];};
const dir=arg('dir');if(!dir)throw Error('DIR_REQUIRED');
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
type Check={id:string;ok:boolean;detail?:string};
const files=async(sub:string)=>{try{return (await readdir(path.join(dir,sub))).sort();}catch{return [];}};
const report:{dir:string;res:unknown[];problems:string[];transfers?:unknown;hisConfirmed?:string;note:string}={dir,res:[],problems:[],note:'Contract conformance of the written files only. HIS acknowledgment is a separate, still unproven condition.'};
const resNames=(await files('res')).filter(f=>f.endsWith('.res')),okNames=new Set((await files('res')).filter(f=>f.endsWith('.ok'))),pdfNames=await files('pdf');
// The Worker keeps a verified copy per release: backup/RELEASE-<id>/{<res>,<pdf>,manifest.json} with the expected hashes and names.
const releaseCopies:{folder:string;manifest:{pdfHash:string;resHash:string;pdfName:string;resName:string}}[]=[];
for(const d of await files('backup')){try{releaseCopies.push({folder:path.join(dir,'backup',d),manifest:JSON.parse(await readFile(path.join(dir,'backup',d,'manifest.json'),'utf8'))});}catch{/* not a release folder */}}
if(!resNames.length)report.problems.push('NO_RES_FILES_FOUND');
for(const name of resNames){
 const checks:Check[]=[];const add=(id:string,ok:boolean,detail?:string)=>{checks.push({id,ok,detail});if(!ok)report.problems.push(`${name}:${id}`);};
 const bytes=await readFile(path.join(dir,'res',name));
 let rows:string[][]=[];
 try{rows=verifyRes(bytes);add('wire_structure_and_utf16le_bom',true);}catch(e){add('wire_structure_and_utf16le_bom',false,(e as Error).message);report.res.push({name,checks});continue;}
 const [h,p,o,r]=rows;
 const ln=p[2],hn=p[3],dob=p[7],specimen=p[23],approval=r[9],certifier=r[10],accession=r[11],generated=h[13];
 add('ln_consistent_P2_P21_O2',ln===p[21]&&ln===o[2]&&/^\d{1,24}$/.test(ln),ln);
 add('hn_pattern',/^[A-Za-z0-9][A-Za-z0-9./_-]{0,31}$/.test(hn),hn);
 add('P7_dob_yyyymmdd_calendar_valid',/^\d{8}$/.test(dob)&&(()=>{const y=+dob.slice(0,4),m=+dob.slice(4,6),d=+dob.slice(6,8);const t=new Date(Date.UTC(y>2400?y-543:y,m-1,d));return m>=1&&m<=12&&t.getUTCMonth()===m-1&&t.getUTCDate()===d;})(),dob);
 const sp=specimen.split('^');
 add('P23_specimen_date_pair',sp.length===2&&sp[0]===sp[1]&&(sp[0]===''||/^\d{14}$/.test(sp[0])),specimen);
 const ap=approval.split('^');
 add('R9_approval_timestamp_pair',ap.length===2&&ap[0]===ap[1]&&/^\d{14}$/.test(ap[0]),approval);
 const cert=certifier.split('^');
 add('R10_certifier_hisid_two_parts',cert.length===2&&cert.every(x=>x.trim().length>0&&!/[|\\~&]/.test(x)),certifier);
 add('R11_accession_starts_with_ln',accession.startsWith(ln),accession);
 let expectedName='';try{expectedName=resFilename(ln,generated);}catch{/* reported below */}
 add('res_filename_matches_ln_and_header_time',expectedName===name,`${name} vs ${expectedName||'n/a'}`);
 const okName=name.replace(/\.res$/,'.ok');
 add('ok_marker_present',okNames.has(okName));
 if(okNames.has(okName)){const ok=await readFile(path.join(dir,'res',okName));add('ok_marker_is_bom_only',ok.length===2&&ok[0]===255&&ok[1]===254,`${ok.length} bytes`);}
 const copy=releaseCopies.find(c=>c.manifest.resName===name);
 add('backup_release_folder_with_manifest',!!copy,copy?path.basename(copy.folder):'none');
 add('res_hash_equals_manifest_and_backup_copy',!!copy&&copy.manifest.resHash===sha(bytes)&&sha(await readFile(path.join(copy.folder,name)).catch(()=>Buffer.alloc(0)))===sha(bytes));
 const pdfMatch=pdfNames.filter(f=>f.endsWith('.pdf')&&f.includes(hn.replace(/[\\/:*?"<>|]/g,'_'))&&f.includes(ln));
 add('pdf_named_for_hn_and_ln',pdfMatch.length>=1,pdfMatch.join(','));
 for(const f of pdfMatch){const b=await readFile(path.join(dir,'pdf',f));add('pdf_header_and_size:'+f,b.subarray(0,5).toString()==='%PDF-'&&(await stat(path.join(dir,'pdf',f))).size>1024);add('pdf_hash_equals_manifest_and_backup_copy:'+f,!!copy&&copy.manifest.pdfName===f&&copy.manifest.pdfHash===sha(b)&&sha(await readFile(path.join(copy.folder,f)).catch(()=>Buffer.alloc(0)))===sha(b));}
 report.res.push({name,ln,hn,dob,specimenDate:specimen,approval,certifier,accession,checks});
}
const dbFile=arg('database-url-file');
if(dbFile){
 const {Client}=await import('pg');
 const c=new Client({connectionString:(await readFile(dbFile,'utf8')).trim()});await c.connect();
 try{
  const rows=(await c.query<{state:string;his:string|null}>("SELECT model->>'state' state,model->>'hisConfirmed' his FROM p6_transfer")).rows;
  report.transfers=rows.reduce<Record<string,number>>((a,r)=>{a[r.state]=(a[r.state]??0)+1;return a;},{});
  const confirmed=rows.filter(r=>r.his==='true').length;report.hisConfirmed=confirmed===0?'false (none of the transfers is reported as HIS-confirmed)':`VIOLATION: ${confirmed}`;
  if(confirmed)report.problems.push('HIS_CONFIRMED_WITHOUT_APPROVED_ACK');
 }finally{await c.end();}
}
const out=arg('out');if(out)await writeFile(out,JSON.stringify(report,null,2));
process.stdout.write(JSON.stringify({files:report.res.length,problems:report.problems,hisConfirmed:report.hisConfirmed,transfers:report.transfers,note:report.note})+'\n');
if(report.problems.length)process.exitCode=1;

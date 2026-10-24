import type {Queryable} from '../db/connection';
import {recordPhiAccess} from '../db/phi-access';
import {audit,LabError,type Staff} from '../lab/core';
import {readSeqPair} from '../lab/seq-export';
import type {WorkbookDeps} from '../workbook/service';
import {readArchive,writeArchive,sha256} from '../workbook/archive';
import {readNiftyRequestRows} from './halos-adapter';

// Task 3 pathway B, before an outage: an authorised LAB user downloads, for one frozen sequencing export, everything external ReadyGen
// needs to produce the Final PDF while NIPT-CBH is unavailable. The package works without this server, its database, network
// service or login: hashes are verified offline with the included PowerShell script. It contains PHI and must be kept on the
// hospital's encrypted, access-controlled media (see docs/task3-readygen-outage-sop.md); every download is audited.
export const FALLBACK_SCHEMA='NIPT-CBH-READYGEN-FALLBACK-1';
export const FALLBACK_SOP='docs/task3-readygen-outage-sop.md (Task 3, 2026-10-25)';
/**
 * ReadyGen's own alias table (Config/enrichment/enrich_alias.txt) prints column J "Original Sample No." as the report HN and uses
 * column O "Admission No." (LNChon) for file names, whereas the Owner-locked NIFTY vendor export (LAB-13 F04) puts the HIS LN in J and
 * the HN in O. The ReadyGen input copy therefore swaps exactly those two cells in every data row and changes nothing else; the
 * vendor export itself is included unchanged. This mapping needs Owner confirmation before operational use.
 */
export function readygenInputNifty(vendor:Buffer){
 const parts=readArchive(vendor),name='xl/worksheets/sheet1.xml',sheet=parts.get(name)?.toString('utf8');if(!sheet)throw new LabError('NIFTY_SHEET_MISSING',409);
 let swapped=0;
 const xml=sheet.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g,(row,n:string)=>{
  if(Number(n)<2)return row;
  const cell=(c:string)=>new RegExp(`<c\\b([^>]*?\\br="${c}${n}"[^>]*?)(?:/>|>([\\s\\S]*?)</c>)`).exec(row);
  const j=cell('J'),o=cell('O');if(!j||!o)return row;
  const attrs=(m:RegExpExecArray)=>({style:/\ss="\d+"/.exec(m[1])?.[0]??'',type:/\st="[^"]*"/.exec(m[1])?.[0]??'',body:m[2]??null});
  const a=attrs(j),b=attrs(o),text=(x:ReturnType<typeof attrs>)=>(x.body??'').replace(/<[^>]+>/g,'').trim();
  if(!text(a)&&!text(b))return row;
  const build=(c:string,style:string,from:ReturnType<typeof attrs>)=>from.body===null?`<c r="${c}${n}"${style}/>`:`<c r="${c}${n}"${style}${from.type}>${from.body}</c>`;
  swapped++;
  return row.replace(j[0],'\u0000J').replace(o[0],build(`O`,b.style,a)).replace('\u0000J',build('J',a.style,b));
 });
 parts.set(name,Buffer.from(xml,'utf8'));
 return {bytes:writeArchive(parts),swappedRows:swapped};
}
const VERIFY_PS1=`param([string]$Folder=$PSScriptRoot)
# Offline check of a NIPT-CBH ReadyGen fallback package: recomputes SHA-256 of every file listed in manifest.json.
# Needs only Windows PowerShell; no NIPT-CBH server, database, network or login.
$ErrorActionPreference='Stop'
$manifest=Get-Content -LiteralPath (Join-Path $Folder 'manifest.json') -Raw -Encoding utf8 | ConvertFrom-Json
$bad=0;$sha=[System.Security.Cryptography.SHA256]::Create()
foreach($f in $manifest.files){
  $p=Join-Path $Folder $f.name
  if(-not (Test-Path -LiteralPath $p)){Write-Output "MISSING  $($f.name)";$bad++;continue}
  # .NET directly: Get-FileHash is a module function that is not found when the module path belongs to another PowerShell.
  $s=[System.IO.File]::OpenRead($p);try{$h=([System.BitConverter]::ToString($sha.ComputeHash($s)) -replace '-','').ToLowerInvariant()}finally{$s.Dispose()}
  if($h -ne $f.sha256){Write-Output "MISMATCH $($f.name)";$bad++}else{Write-Output "OK       $($f.name)"}
}
if($bad){Write-Output "PACKAGE INVALID ($bad)";exit 1}else{Write-Output "PACKAGE VERIFIED: $($manifest.schema) export $($manifest.exportPairId)";exit 0}
`;
const README=(m:{batchId:string;exportPairId:string;createdAt:string;rows:number})=>`NIPT-CBH — ชุดสำรองสำหรับ ReadyGen (ใช้เมื่อระบบ NIPT-CBH ใช้งานไม่ได้)
ReadyGen fallback package (for use when NIPT-CBH is unavailable)

Export pair: ${m.exportPairId}
Batch: ${m.batchId}
Created: ${m.createdAt}
NIFTY sample rows (incl. PC/NC): ${m.rows}

ไฟล์ / Files
1. NIFTY-vendor.xlsx          — ไฟล์ NIFTY ที่ส่งออกจาก NIPT-CBH ตามจริง (ไม่แก้ไข) / exact vendor export, unchanged
2. NIFTY-readygen-input.xlsx  — สำเนาสำหรับ ReadyGen: สลับเฉพาะคอลัมน์ J (HN) และ O (LN) ตามตาราง alias ของ ReadyGen
                                 ReadyGen input copy: only columns J (HN) and O (HIS LN) are swapped, per ReadyGen's alias table
                                 (ต้องได้รับการยืนยันจาก Owner ก่อนใช้งานจริง / requires Owner confirmation before operational use)
3. HALOS-Task-Import.xlsx     — ไฟล์ Task Import ของ HALOS ชุดเดียวกัน / the paired HALOS task file
4. manifest.json              — SHA-256 ของทุกไฟล์ / hashes of every file
5. Verify-Package.ps1         — ตรวจ SHA-256 แบบออฟไลน์ / offline verification

ขั้นตอนย่อ (ดูฉบับเต็มใน ${FALLBACK_SOP})
- เก็บชุดนี้ในสื่อที่เข้ารหัสและควบคุมการเข้าถึงของโรงพยาบาลเท่านั้น — มีข้อมูลผู้ป่วย ห้ามส่งทางอีเมล/แชต
- ก่อนใช้: เปิด PowerShell ในโฟลเดอร์นี้แล้วรัน  .\\Verify-Package.ps1  ต้องได้ "PACKAGE VERIFIED"
- ใช้ NIFTY-readygen-input.xlsx คู่กับไฟล์ HALOS "Sample analysis data" ใน ReadyGen ที่ติดตั้งและได้รับอนุญาตแล้ว
- ผลที่ออกจาก ReadyGen ต้องลงนามตามระเบียบเดิม เมื่อระบบกลับมา ให้นำเข้า PDF ผ่านหน้าเคส "อัปโหลด PDF ผลตรวจ"
  พร้อมบันทึกเลขอ้างอิงเหตุขัดข้อง และถ้าผลถูกบันทึกใน HIS แล้ว ให้ติ๊ก "มีผลใน HIS แล้ว" เพื่อไม่ส่งซ้ำ
`;
export async function fallbackPackage(db:Queryable,user:Staff,pairId:string,deps:WorkbookDeps){
 const pair=await readSeqPair(db,user,pairId,deps);
 const row=(await db.query<{batch_id:string;created_at:Date;mapping:{caseId?:string|null}[]}>('SELECT p.batch_id,p.created_at,n.mapping FROM lab_seq_export_pair p JOIN lab_bench_export n ON n.id=p.nifty_export_id WHERE p.id=$1',[pair.id])).rows[0];
 const nifty=pair.files.find(f=>f.kind==='NIFTY_XLSX'),halos=pair.files.find(f=>f.kind==='HALOS_TASK_XLSX');if(!nifty||!halos)throw new LabError('SEQ_EXPORT_NOT_FOUND',404);
 const vendor=await deps.store.get(nifty.sha256),task=await deps.store.get(halos.sha256);
 const input=readygenInputNifty(vendor),rows=readNiftyRequestRows(vendor).length;
 if(readNiftyRequestRows(input.bytes).length!==rows)throw new LabError('READYGEN_INPUT_ROW_COUNT_MISMATCH',409);
 const createdAt=new Date().toISOString();
 const files:[string,Buffer,string][]=[['NIFTY-vendor.xlsx',vendor,'NIFTY_VENDOR_EXPORT_UNCHANGED'],['NIFTY-readygen-input.xlsx',input.bytes,'READYGEN_INPUT_J_O_SWAPPED'],['HALOS-Task-Import.xlsx',task,'HALOS_TASK_IMPORT_UNCHANGED'],
  ['README-TH-EN.txt',Buffer.from(README({batchId:row.batch_id,exportPairId:pair.id,createdAt,rows}),'utf8'),'INSTRUCTIONS'],['Verify-Package.ps1',Buffer.from(VERIFY_PS1.replace(/\n/g,'\r\n'),'utf8'),'OFFLINE_VERIFIER']];
 const manifest={schema:FALLBACK_SCHEMA,exportPairId:pair.id,batchId:row.batch_id,exportCreatedAt:row.created_at,packageCreatedAt:createdAt,createdBy:user.id,sop:FALLBACK_SOP,niftyRows:rows,readygenSwappedRows:input.swappedRows,
  sourceHashes:{niftyVendor:nifty.sha256,halosTask:halos.sha256},files:files.map(([name,bytes,role])=>({name,role,bytes:bytes.length,sha256:sha256(bytes)}))};
 const zip=writeArchive(new Map<string,Buffer>([...files.map(([n,b])=>[n,b] as [string,Buffer]),['manifest.json',Buffer.from(JSON.stringify(manifest,null,2),'utf8')]]));
 await recordPhiAccess(db,user.id,[...new Set(row.mapping.flatMap(m=>m.caseId?[m.caseId]:[]))],'CASE_DETAIL_VIEW');
 await audit(db,user,'READYGEN_FALLBACK_PACKAGE_DOWNLOADED','lab_seq_export_pair',pair.id,{outcome:'PACKAGE',count:rows});
 return {bytes:zip,sha256:sha256(zip),filename:`READYGEN-FALLBACK-${pair.id.slice(0,8)}-${createdAt.slice(0,10)}.zip`,manifest};
}

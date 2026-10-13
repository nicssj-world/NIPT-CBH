import {crc32,deflateRawSync} from 'node:zlib';

// Deterministic synthetic result files for tests and the simulator folder (no PDF/ZIP is ever committed — source guard).
// Text follows the NIPTY BGI anchors so the parser is exercised on the same strings; every file says SYNTHETIC.
export type ReportSpec={kind:'SINGLETON'|'TWIN'|'NOTICE'|'UNKNOWN';labNumber:string;hn:string;name?:string;dob?:string;collection:string;received?:string;reported?:string;
 gaWeeks?:number;gaDays?:number;risks?:[string,string,string];sex?:'Male'|'Female'|null;sca?:[string,string,string,string]|null;ff?:string;qc?:string;y?:string;notice?:string;omit?:('trisomy'|'sca'|'qc')[]};
export function reportText(s:ReportSpec):string[]{
 const head=[`SYNTHETIC NIPT REPORT - NOT FOR CLINICAL USE`];
 if(s.kind==='NOTICE')return [...head,`BKGI-NIPT (LN: ${s.labNumber}) HN: ${s.hn}`,`Sample Collection Date: ${s.collection}`,s.notice??'Re-sampling is recommended: grey area result',`Reported Date: ${s.reported??'20-Oct-2026'}`];
 if(s.kind==='UNKNOWN')return [...head,`Unrecognised synthetic document`,`HN: ${s.hn}`];
 const r=s.risks??['Low Risk','Low Risk','Low Risk'];
 const lines=[...head,`Lab No. (LN): ${s.labNumber} HN: ${s.hn} Sample Collection Date: ${s.collection}`,`Patient Name: ${s.name??'SYNTHETIC PATIENT'} Gestational Age: ${s.gaWeeks??12} Weeks ${s.gaDays??2} Day(s)`,
  `DOB: ${s.dob??'31-Mar-1996'} Sample Received Date: ${s.received??'11-Oct-2026'}`];
 if(s.kind==='TWIN'){lines.push('TWIN PREGNANCY');if(!s.omit?.includes('trisomy'))lines.push('TRISOMY 21 TRISOMY 18 TRISOMY 13 Y CHROMOSOME',`${r.join(' ')} ${s.y??'Detected'}`);lines.push(`Fetal Fraction: ${s.ff??'9.10'}%`);}
 else{
  if(!s.omit?.includes('trisomy'))lines.push('TRISOMY 21 TRISOMY 18 TRISOMY 13 Fetal Gender',`${r.join(' ')}${s.sex===null?'':' '+(s.sex??'Female')}`);
  if(!s.omit?.includes('sca'))lines.push('SEX CHROMOSOME ANEUPLOIDIES','XO XXX XXY XYY Fetal Fraction (>=3.5%)',`${(s.sca??['Not Detected','Not Detected','Not Detected','Not Detected']).join(' ')} ${s.ff??'12.40'}`);
 }
 if(!s.omit?.includes('qc'))lines.push(`RESULTS QC: ${s.qc??'PASS'}`);
 lines.push(`Reported Date: ${s.reported??'20-Oct-2026'}`);
 return lines;
}
/** Minimal single-page PDF 1.4 with Helvetica text lines (ASCII). Byte-for-byte deterministic. */
export function syntheticPdf(lines:string[]):Buffer{
 const esc=(t:string)=>t.replace(/[\\()]/g,m=>'\\'+m).replace(/[^\x20-\x7e]/g,'?');
 const stream=lines.map((l,n)=>`BT /F1 10 Tf 40 ${800-n*16} Td (${esc(l)}) Tj ET`).join('\n');
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
 let out='%PDF-1.4\n';const offsets:number[]=[];
 objects.forEach((o,n)=>{offsets.push(Buffer.byteLength(out));out+=`${n+1} 0 obj\n${o}\nendobj\n`;});
 const xref=Buffer.byteLength(out);
 out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return Buffer.from(out,'latin1');
}
export const syntheticReportPdf=(s:ReportSpec)=>syntheticPdf(reportText(s));
/** ZIP writer (stored or deflate) for NIPTY ZIP-as-PDF (manifest.json + 1.txt) and batch ZIPs. */
export function syntheticZip(entries:{name:string;data:Buffer;deflate?:boolean}[]):Buffer{
 const locals:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const e of entries){
  const name=Buffer.from(e.name,'utf8'),body=e.deflate?deflateRawSync(e.data):e.data,crc=crc32(e.data)>>>0,method=e.deflate?8:0;
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(method,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(body.length,18);h.writeUInt32LE(e.data.length,22);h.writeUInt16LE(name.length,26);
  locals.push(h,name,body);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(method,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(body.length,20);c.writeUInt32LE(e.data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);
  central.push(c,name);offset+=30+name.length+body.length;
 }
 const cd=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,cd,end]);
}
export const zipAsPdf=(s:ReportSpec)=>syntheticZip([{name:'manifest.json',data:Buffer.from(JSON.stringify({pages:[{text:{path:'1.txt'}}]}))},{name:'1.txt',data:Buffer.from(reportText(s).join('\n'))}]);

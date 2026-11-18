import {writeArchive,xmlEscape} from '../../packages/workbook/archive';

/** The 20 columns of the HIS ANC export, in HIS order (Owner 2026-11-18). */
export const HIS_ANC_HEADER=['hospcode','hn','cid','brthdate','pttype','age','seq','date_serv','gravida','ancno','ga','ancresult','ancplace','provider','weight','height','bmi','edc','nipt_date','nipt'];
export type HisAncFixtureRow=Partial<Record<(typeof HIS_ANC_HEADER)[number],string>>;
export const hisAncRow=(over:HisAncFixtureRow={}):HisAncFixtureRow=>({hospcode:'10662',hn:'9901001',cid:'1209000008138',brthdate:'18/07/2001',pttype:'UC',age:'25',seq:'691075220',date_serv:'18/11/2026',gravida:'2',ancno:'4',ga:'28+0',ancresult:'9',ancplace:'10662',provider:'พญ.SYNTHETIC ทดสอบ',weight:'99.6',height:'160.0',bmi:'38.91',edc:'10/02/2027',nipt_date:'',nipt:'',...over});

/** A one-sheet .xlsx with every cell stored as text, like the HIS export. */
export function hisAncWorkbook(rows:HisAncFixtureRow[],header:readonly string[]=HIS_ANC_HEADER):Buffer{
 const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
 const letter=(n:number)=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
 const grid=[[...header],...rows.map(r=>header.map(h=>r[h.trim().toLowerCase()]??''))];
 const sheet=`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetData>${grid.map((r,i)=>`<row r="${i+1}">${r.map((v,c)=>v===''?'':`<c r="${letter(c)}${i+1}" t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;
 return writeArchive(new Map(Object.entries({
  '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  'xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':sheet,
 }).map(([k,v])=>[k,Buffer.from(v)])));
}

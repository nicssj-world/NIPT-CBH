import {wireDate} from './pet';
export const escapeWire=(v:string)=>v.replace(/\r|\n|\0/g,()=>{throw Error('STRUCTURAL_INJECTION')}).replace(/\\/g,'\\E\\').replace(/\|/g,'\\F\\').replace(/\^/g,'\\S\\').replace(/~/g,'\\R\\').replace(/&/g,'\\T\\');
export function timestamp(value:string){let v=value;if(/^\d{2}\/\d{2}\/\d{4}/.test(v)){const m=/^(\d{2})\/(\d{2})\/(\d{4})(?:\s*-?\s*(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);if(!m)throw Error('INVALID_DATE');let year=+m[3];if(year>2400)year-=543;v=`${year}${m[2]}${m[1]}${m[4]||'00'}${m[5]||'00'}${m[6]||'00'}`;}else if(/^\d{4}-\d{2}-\d{2}/.test(v)){v=v.slice(0,19).replace(/[-T :]/g,'');}if(v.length===8)v+='000000';wireDate(v);return v;}
const join=(a:string[],word='and')=>a.length<2?a[0]||'':a.length===2?a.join(' '+word+' '):a.slice(0,-1).join(', ')+', '+word+' '+a.at(-1);
export function resultText(values:Record<string,string>|null,style:'full'|'short'|'fixed'='full',cfs='ดูรายงานผลในโปรแกรม CFS'){cfs=cfs.trim()||'ดูรายงานผลในโปรแกรม CFS';if(style==='fixed'||!values)return cfs;if(values.redraw==='true')return `redraw requested (${cfs})`;const tri=['t21','t18','t13'],tn=['Trisomy 21','Trisomy 18','Trisomy 13'],sca=['sex_xo','sex_xxx','sex_xxy','sex_xyy'],sn=['45,X','47,XXX','47,XXY','47,XYY'];const tk=tri.every(k=>!!values[k]),sk=sca.every(k=>!!values[k]);if(!tk&&!sk)return `Result not available in system, see report (${cfs})`;const parts:string[]=[];const hi=tn.filter((_,i)=>values[tri[i]]?.includes('High')),lo=tn.filter((_,i)=>values[tri[i]]?.includes('Low'));if(hi.length){parts.push('High risk for fetal '+join(hi));if(style==='full'&&lo.length)parts.push('Low risk for '+join(lo));}else parts.push(tk?(style==='full'?'Low risk for Trisomy 21, Trisomy 18, and Trisomy 13':'Low risk for common fetal trisomies'):'Trisomy result not available in system');const detected=sn.filter((_,i)=>values[sca[i]]==='Detected');if(detected.length)parts.push(join(detected)+(style==='full'?' was detected':' detected'));else if(!sk)parts.push('Sex chromosome result not available in system');else if(style==='full')parts.push('No evidence of 45,X, 47,XXX, 47,XXY, or 47,XYY was detected');return parts.join('. ')+`. (${cfs})`;}
export const RES_ACCESSION_SUFFIX = '118';
export function resFilename(ln: string, generatedAt: string) {
  if (!/^\d+$/.test(ln)) throw Error('INVALID_RES_LN');
  if (!/^\d{14}$/.test(generatedAt)) throw Error('INVALID_RES_TIMESTAMP');
  wireDate(generatedAt);
  return ln + generatedAt.slice(8, 10) + generatedAt[11] + '.res';
}
export interface ResInput{ln:string;hn:string;surname:string;prefix:string;firstname:string;dob:string;sex:string;specimenAt:string;generatedAt:string;approvedAt:string;wardId?:string;wardName?:string;result:Record<string,string>|null;style?:'full'|'short'|'fixed';operator?:string;}
export function serializeRes(x:ResInput){if(!/^99000\d+$/.test(x.ln)||!x.hn.startsWith('SYNTHETIC-'))throw Error('SYNTHETIC_ONLY');Object.values(x).filter(v=>typeof v==='string').forEach(v=>{if(/[\r\n\0]/.test(v as string))throw Error('STRUCTURAL_INJECTION');});const ts=timestamp(x.generatedAt),approval=timestamp(x.approvedAt),spec=x.specimenAt?timestamp(x.specimenAt):'';const p=Array<string>(35).fill(''),o=Array<string>(26).fill(''),r=Array<string>(12).fill('');const ward=x.wardId||'301';if(!/^[A-Za-z0-9_-]+$/.test(ward)||!/^SYNTHETIC\^SYNTHETIC$/.test(x.operator||'SYNTHETIC^SYNTHETIC'))throw Error('INVALID_COMPONENT');if(!/^\d{8}$/.test(x.dob))throw Error('INVALID_DATE');wireDate(x.dob);Object.assign(p,{0:'P',1:'1',2:escapeWire(x.ln),3:escapeWire(x.hn),4:'^',5:`${escapeWire(x.surname)}^^${escapeWire(x.prefix)} ${escapeWire(x.firstname)}`,7:x.dob,8:x.sex,21:x.ln,23:`${spec}^${spec}`,24:'R',25:`${ward}^${escapeWire(x.wardName||'SYNTHETIC')}`,27:'^O',33:`0^${ward}`,34:'^99'});if(!/^[FMU]$/.test(x.sex))throw Error('INVALID_SEX');Object.assign(o,{0:'O',1:'1',2:x.ln,4:'^^^70096^B^0',15:'2',18:'7',25:'F'});Object.assign(r,{0:'R',1:'1',2:'^^^70096^B^0',3:escapeWire(resultText(x.result,x.style)),6:'A',8:'F',9:`${approval}^${approval}`,10:x.operator||'SYNTHETIC^SYNTHETIC',11:x.ln+RES_ACCESSION_SUFFIX});const text=[`H|\\^&|||CIT5K|||||HOST||P||${ts}`,p.join('|'),o.join('|'),r.join('|'),'L|1|N'].join('\r')+'\r';return {filename:resFilename(x.ln,ts),bytes:Buffer.concat([Buffer.from([255,254]),Buffer.from(text,'utf16le')])};}
export function verifyRes(bytes: Buffer) {
  if (bytes[0] !== 255 || bytes[1] !== 254 || bytes.length % 2) throw Error('INVALID_BOM');
  let text: string;
  try {
    text = new TextDecoder('utf-16le', {fatal: true, ignoreBOM: true}).decode(bytes.subarray(2));
  } catch {
    throw Error('INVALID_RES_ENCODING');
  }
  if (text.includes('\0')) throw Error('INVALID_RES_ENCODING');
  if (text.includes('\n') || !text.endsWith('\r')) throw Error('INVALID_RECORD_SEPARATOR');
  const rows = text.slice(0, -1).split('\r').map(r => r.split('|'));
  if (rows.length !== 5 || rows.some((r, i) => r.length !== [14, 35, 26, 12, 3][i] || r[0] !== ['H', 'P', 'O', 'R', 'L'][i])) {
    throw Error('INVALID_RECORD_WIDTH');
  }
  return rows;
}

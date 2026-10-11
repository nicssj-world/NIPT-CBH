import iconv from 'iconv-lite';
import {sha256} from '../storage';
import {identityLookup} from '../security/envelope';
export function safeField(value:string){if(/[\r\n\0|]/.test(value))throw Error('STRUCTURAL_INJECTION');return value;}
export function wireDate(value:string){if(!/^\d{8}(\d{6})?$/.test(value))throw Error('INVALID_DATE');const y=+value.slice(0,4),m=+value.slice(4,6),d=+value.slice(6,8);const h=+(value.slice(8,10)||0),n=+(value.slice(10,12)||0),s=+(value.slice(12,14)||0);const date=new Date(Date.UTC(y,m-1,d,h,n,s));if(y<1900||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d||h>23||n>59||s>59)throw Error('INVALID_DATE');return `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${String(h).padStart(2,'0')}:${String(n).padStart(2,'0')}:${String(s).padStart(2,'0')}+07:00`;}
export interface Pet{ln:string;hn:string;name:string;dob:string;sex:string;receivedAt:string;specimenAt:string;orderAt:string;ward:string;identity:string;hash:string;filename:string;}
export function parsePet(bytes:Buffer,filename:string):Pet{
 const match=/^(\d+)-7\.pet$/i.exec(filename);if(!match)throw Error('INVALID_FILENAME');
 const decoded=iconv.decode(bytes,'windows-874');if(decoded.includes('\ufffd')||!iconv.encode(decoded,'windows-874').equals(bytes)||/[\0]/.test(decoded))throw Error('INVALID_ENCODING');
 const lines=decoded.replace(/\r\n/g,'\n').split('\n').filter(x=>x.trim());if(lines.some(x=>x.includes('\r')))throw Error('INVALID_RECORD_SEPARATOR');const records=lines.map(x=>x.split('|'));const p=records.find(x=>x[0]==='P');const o=records.find(x=>x[0]==='O'&&x[4]?.split('^').find(c=>/^\d+$/.test(c))==='70096');
 if(!p||p.length!==35||!o||o.length!==29||!p[2]||!p[3]||o[18]!=='7')throw Error('INVALID_FIELDS');if(p[2]!==match[1]||!/^\d+$/.test(p[2]))throw Error('LN_MISMATCH');
 for(const row of records)for(const field of row)safeField(field);
 if(!p[2].startsWith('99000')||!p[3].startsWith('SYNTHETIC-')||!p[5].includes('SYNTHETIC')||!p[33].split('^')[1]?.startsWith('SYNTHETIC-'))throw Error('SYNTHETIC_ONLY');
 const [ward,identity]=p[33].split('^');return {ln:p[2],hn:p[3],name:p[5],dob:wireDate(p[7]),sex:p[8],receivedAt:wireDate(p[21]),specimenAt:wireDate(p[23].split('^')[0]),orderAt:wireDate(o[14]),ward,identity,hash:sha256(bytes),filename};
}
export function syntheticPet(index:number,date='20261011120000'){const ln=`99000${String(index).padStart(7,'0')}`;const p=Array<string>(35).fill('');Object.assign(p,{0:'P',1:'1',2:ln,3:`SYNTHETIC-HN-${index}`,5:'SYNTHETIC^^นาง SYNTHETIC',7:'20000101',8:'F',21:date,23:date+'^'+date,33:`SYNTHETIC-WARD^SYNTHETIC-ID-${index}`});const o=Array<string>(29).fill('');Object.assign(o,{0:'O',1:'1',4:'^^^70096^B^0',14:date,18:'7'});return {ln,filename:ln+'-7.pet',bytes:iconv.encode(['H',p.join('|'),o.join('|'),'L|1|N'].join('\r\n'),'windows-874')};}

export function petIdentityKey(pet:Pet,lookupKey:Buffer){if(!/^SYNTHETIC-ID-[A-Za-z0-9_-]+$/.test(pet.identity))throw Error("SYNTHETIC_IDENTITY_REQUIRED");return identityLookup(pet.identity,lookupKey);}

import {normalizeHeader,readXlsx} from '../readygen/xlsx';
import {hash,sourceEvidence,type SourceInput,type MigrationMapping,type MigrationException} from './model';
/** Source text stays byte-for-byte cell text; whitespace is reported, never silently rewritten. */
export function parseMapping(source:SourceInput){
 const evidence=sourceEvidence('GENOMIC_MAPPING',source),sheets=readXlsx(source.bytes);
 const candidates=sheets.filter(s=>s.rows[0]&&[...s.rows[0].cells.values()].some(c=>normalizeHeader(c.text)==='ln'));
 if(candidates.length!==1)throw new Error('MAPPING_SHEET_AMBIGUOUS');
 const sheet=candidates[0],header=sheet.rows[0];
 const columns=(label:string)=>[...header.cells.values()].filter(c=>normalizeHeader(c.text)===label).map(c=>c.column);
 const ln=columns('ln'),halos=columns('ln halos');if(ln.length!==1||halos.length!==1)throw new Error('MAPPING_HEADERS_INVALID');
 const mappings:MigrationMapping[]=sheet.rows.filter(r=>r.number>header.number).map(r=>({sourceKey:hash(evidence.sha256+':'+sheet.name+':'+r.number),sheet:sheet.name,rowNumber:r.number,hisLn:r.cells.get(ln[0])?.text??'',halosId:r.cells.get(halos[0])?.text??'',valid:true,classification:'NO_HALOS',hisPdfExists:false,analysisKeys:[],currentAnalysisKey:null,exceptions:[]}));
 const add=(r:MigrationMapping,code:string)=>{r.valid=false;r.exceptions.push({code,severity:'REVIEW_BEFORE_RELEASE',sourceSha256:evidence.sha256,rowNumber:r.rowNumber,sourceKey:r.sourceKey,sheet:sheet.name});};
 for(const r of mappings){if(!r.hisLn||!r.halosId)add(r,'MAPPING_ID_MISSING');else if(r.hisLn.trim()!==r.hisLn||r.halosId.trim()!==r.halosId||/[\u0000-\u001f]/.test(r.hisLn+r.halosId))add(r,'MAPPING_ID_WHITESPACE_OR_CONTROL');else if(!/^[0-9]+$/.test(r.hisLn))add(r,'MAPPING_LN_INVALID');else if(!/^[A-Za-z0-9][A-Za-z0-9-]{3,39}$/.test(r.halosId))add(r,'MAPPING_HALOS_ID_INVALID');}
 for(const field of ['hisLn','halosId'] as const){const groups=new Map<string,MigrationMapping[]>();for(const r of mappings){if(r[field])groups.set(r[field],[...(groups.get(r[field])??[]),r]);}for(const rs of groups.values())if(rs.length>1)for(const r of rs)add(r,field==='hisLn'?'MAPPING_DUPLICATE_LN':'MAPPING_DUPLICATE_HALOS');}
 return {source:evidence,mappings,exceptions:mappings.flatMap(r=>r.exceptions) as MigrationException[]};
}


// Shared PDF download/CFS name; storage SHA-256 and the legacy RES/OK names are independent.
export const FILENAME_PLACEHOLDERS=['run','hisLn','lnHalos','sampleId','hn','patientName','reportDate','template','version'] as const;
export type FilenameValues=Record<Exclude<(typeof FILENAME_PLACEHOLDERS)[number],'run'>,string>&{run?:string};
export const DEFAULT_DOWNLOAD_TEMPLATE='{run}_{hn}_{hisLn}';
/** Source lab run stores a CE calendar year; report filenames use the Buddhist year. Never use today's year. */
export function reportRunToken(number:number,year:number){
 if(!Number.isSafeInteger(number)||number<1||!Number.isSafeInteger(year)||year<1900||year>2400)throw Error('REPORT_RUN_INVALID');
 return `run${String(number).padStart(2,'0')}${year+543}`;
}
const WINDOWS_RESERVED=/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
const FORBIDDEN=/[<>:"/\\|?*\u0000-\u001f]/;
/** A template is valid when every placeholder is known and it identifies the report (contains the HIS LN or the sample ID). */
export function templateProblems(template:string){
 const problems:string[]=[];
 if(template.length<5||template.length>160)problems.push('LENGTH');
 const tokens=[...template.matchAll(/\{([^{}]*)\}/g)].map(m=>m[1]);
 if(/[{}]/.test(template.replace(/\{[A-Za-z]+\}/g,'')))problems.push('BRACES');
 for(const t of tokens)if(!(FILENAME_PLACEHOLDERS as readonly string[]).includes(t))problems.push('UNKNOWN_PLACEHOLDER_'+t.toUpperCase().replace(/[^A-Z0-9]/g,'_').slice(0,30));
 if(!tokens.includes('hisLn')&&!tokens.includes('sampleId'))problems.push('IDENTIFIER_REQUIRED');
 if(FORBIDDEN.test(template.replace(/\{[A-Za-z]+\}/g,'')))problems.push('FORBIDDEN_CHARACTER');
 return problems;
}
/** Windows-safe name: forbidden characters become "_", no trailing dot/space, no reserved device names, bounded length. */
export function renderDownloadName(template:string,values:FilenameValues){
 if(templateProblems(template).length)throw new Error('DOWNLOAD_NAME_TEMPLATE_INVALID');
 if(template.includes('{run}')&&!values.run)throw Error('REPORT_RUN_REQUIRED');
 let base=template.replace(/\{([A-Za-z]+)\}/g,(_,k:keyof FilenameValues)=>values[k]??'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/\s+/g,' ').trim();
 base=base.slice(0,150).replace(/[. ]+$/,'');
 if(!base||WINDOWS_RESERVED.test(base))base='report_'+values.hisLn;
 return base+'.pdf';
}
/** Collision policy inside one download/ZIP: identical names get " (2)", " (3)", ... before the extension. */
export function uniqueNames(names:string[]){
 const seen=new Map<string,number>();
 return names.map(n=>{const key=n.toLowerCase(),count=(seen.get(key)??0)+1;seen.set(key,count);return count===1?n:n.replace(/\.pdf$/i,` (${count}).pdf`);});
}

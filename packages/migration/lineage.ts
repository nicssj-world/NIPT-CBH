/** Only validated HALOS terminal attempt suffixes with same-run sampleinfo context are accepted. R/D remain identity. */
export function resolveMigrationIdentity(sample:string,mappingIds:readonly string[],sampleinfoIds:readonly string[]){
 if(mappingIds.includes(sample))return {baseId:sample,attemptOrdinal:1};
 const m=/^(.+)-([1-9][0-9]?)$/.exec(sample);
 if(!m||!mappingIds.includes(m[1])||!sampleinfoIds.includes(m[1]))return {baseId:null,attemptOrdinal:null};
 return {baseId:m[1],attemptOrdinal:Number(m[2])};
}

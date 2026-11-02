/** Only validated HALOS terminal attempt suffixes with same-run sampleinfo context are accepted. R stays identity.
 *  Twin pregnancies are written "<LN Halos>D-<n>" in HALOS while the mapping holds the plain LN Halos (Owner decision 2026-11-02): the D form is
 *  accepted only when the plain LN Halos is a mapping row, the D form itself is not, and the same run's sampleinfo carries the D form. The
 *  original LN Halos is never changed and no number is created; `infoKey` is the sampleinfo row that proves the twin. */
export function resolveMigrationIdentity(sample:string,mappingIds:readonly string[],sampleinfoIds:readonly string[]):{baseId:string|null;attemptOrdinal:number|null;infoKey?:string}{
 if(mappingIds.includes(sample))return {baseId:sample,attemptOrdinal:1};
 const m=/^(.+)-([1-9][0-9]?)$/.exec(sample);
 if(!m)return {baseId:null,attemptOrdinal:null};
 if(mappingIds.includes(m[1])&&sampleinfoIds.includes(m[1]))return {baseId:m[1],attemptOrdinal:Number(m[2])};
 const twin=/^(.+)D$/.exec(m[1]);
 if(twin&&!mappingIds.includes(m[1])&&mappingIds.includes(twin[1])&&sampleinfoIds.includes(m[1]))return {baseId:twin[1],attemptOrdinal:Number(m[2]),infoKey:m[1]};
 return {baseId:null,attemptOrdinal:null};
}

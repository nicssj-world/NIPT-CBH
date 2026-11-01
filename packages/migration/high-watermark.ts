import {canonical,hash,type MigrationMapping} from './model';
export type AllocatorEvidence={version:1;source:'GENOMIC_READ_ONLY_ALLOCATOR';sourceIdentity:string;capturedAt:string;mappingSha256:string;registryPairsSha256:string;registryPairCount:number;months:Array<{month:string;lastValue:number}>;sourceFrozen:boolean;freezeAssertion?:'ADMINISTRATIVE_ASSERTION_ONLY';snapshotSha256?:string;sha256:string};
export const registryPairsDigest=(rows:Pick<MigrationMapping,'hisLn'|'halosId'>[])=>hash(canonical(rows.map(r=>({hisLn:r.hisLn,halosId:r.halosId})).sort((a,b)=>a.hisLn.localeCompare(b.hisLn)||a.halosId.localeCompare(b.halosId))));
/** Integrity hash is NOT source authentication. Collector must obtain these facts from the authenticated read-only source. */
export function pinAllocatorEvidence(input:Omit<AllocatorEvidence,'sha256'>|AllocatorEvidence):AllocatorEvidence{const payload={...input} as Omit<AllocatorEvidence,'sha256'>&{sha256?:string};delete payload.sha256;return {...payload,sha256:hash(canonical(payload))};}
export function assessWatermark(evidence:AllocatorEvidence|undefined,rows:MigrationMapping[],mappingSha256:string,freshness?:{asOf:string;maxAgeMs?:number}){
 const reasons:string[]=[],excelMonthlyMax:Record<string,number>={};
 for(const r of rows){const m=/^\d{2}B(\d{2})(\d{2})\d{2}(\d{3})(?:R*|D)?(?:-[1-9]\d?)?$/.exec(r.halosId);if(m){const month='20'+m[1]+'-'+m[2]+'-01';excelMonthlyMax[month]=Math.max(excelMonthlyMax[month]??0,Number(m[3]));}}
 if(!evidence)reasons.push('ALLOCATOR_EVIDENCE_MISSING');else{
 if(evidence.version!==1||evidence.source!=='GENOMIC_READ_ONLY_ALLOCATOR'||!evidence.sourceIdentity||!Number.isFinite(Date.parse(evidence.capturedAt)))reasons.push('ALLOCATOR_EVIDENCE_INVALID');
 if(pinAllocatorEvidence(evidence).sha256!==evidence.sha256)reasons.push('ALLOCATOR_EVIDENCE_HASH_MISMATCH');
 if(!evidence.sourceFrozen)reasons.push('SOURCE_ALLOCATION_NOT_FROZEN');
 if(freshness){const at=Date.parse(freshness.asOf),captured=Date.parse(evidence.capturedAt),maxAge=freshness.maxAgeMs??86400000;if(!Number.isFinite(at)||!Number.isFinite(maxAge)||maxAge<0||captured>at||at-captured>maxAge)reasons.push('ALLOCATOR_EVIDENCE_STALE');}
 if(evidence.mappingSha256!==mappingSha256||evidence.registryPairCount!==rows.length||evidence.registryPairsSha256!==registryPairsDigest(rows))reasons.push('REGISTRY_DELTA_REQUIRES_REEXPORT');
 if(rows.some(r=>!r.valid))reasons.push('MAPPING_EXCEPTIONS_PENDING');
 const monthSet=new Set<string>();for(const m of evidence.months){if(!/^20\d{2}-(?:0[1-9]|1[0-2])-01$/.test(m.month)||!Number.isInteger(m.lastValue)||m.lastValue<0||m.lastValue>999||monthSet.has(m.month))reasons.push('ALLOCATOR_MONTH_INVALID');monthSet.add(m.month);}
 for(const [month,max] of Object.entries(excelMonthlyMax)){const counter=evidence.months.find(m=>m.month===month);if(!counter||counter.lastValue<max)reasons.push('ALLOCATOR_BELOW_EXPORTED_IDENTIFIER');}
 }
 return {readyForHandover:reasons.length===0,reasons:[...new Set(reasons)],excelMonthlyMax,authoritativeMonths:evidence?.months??[],evidenceSha256:evidence?.sha256??null};
}



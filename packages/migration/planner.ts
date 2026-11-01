import {parseMapping} from './mapping';
import {ingestHalos,linkMigrationAttempts} from './halos';
import {assessWatermark,registryPairsDigest,type AllocatorEvidence} from './high-watermark';
import {canonical,hash,sourceEvidence,type SourceInput,type MigrationChoice,type MigrationAnalysis,type MigrationRun,type MigrationException} from './model';
export type MigrationPlanInput={mapping:SourceInput;halos:Array<SourceInput&{runLabel:string}>;watermark?:AllocatorEvidence;choices?:MigrationChoice[]};
/** Pure dry run. No clocks, database, HIS, file mutation, registration, release or allocator writes. */
export function buildMigrationPlan(input:MigrationPlanInput){
 const parsed=parseMapping(input.mapping),sources=[parsed.source],mappings=parsed.mappings,analyses:MigrationAnalysis[]=[],runs:MigrationRun[]=[],exceptions=[...parsed.exceptions];
 const seenFiles=new Set<string>(),seenRuns=new Set<string>();let previousRun='';
 for(const source of input.halos){const evidence=sourceEvidence('HALOS_RUN',source,source.runLabel);sources.push(evidence);
 if(!/^Run[0-9]{3}\/20[0-9]{2}$/.test(source.runLabel)||seenRuns.has(source.runLabel)||seenFiles.has(evidence.sha256)||previousRun&&source.runLabel.slice(7)+source.runLabel.slice(3,6)<=previousRun){exceptions.push({code:'HALOS_RUN_ORDER_OR_DUPLICATE',severity:'REVIEW_BEFORE_RELEASE',sourceSha256:evidence.sha256});continue;}
 seenRuns.add(source.runLabel);seenFiles.add(evidence.sha256);previousRun=source.runLabel.slice(7)+source.runLabel.slice(3,6);
 try{const result=ingestHalos(source,mappings,analyses);analyses.push(...result.analyses);runs.push(result.run);exceptions.push(...result.exceptions);}catch{exceptions.push({code:'HALOS_FILE_INVALID',severity:'REVIEW_BEFORE_RELEASE',sourceSha256:evidence.sha256});}
 }
 linkMigrationAttempts(mappings,analyses,exceptions);
 for(const choice of input.choices??[]){const matches=mappings.filter(m=>choice.sourceKey?m.sourceKey===choice.sourceKey:choice.hisLn!==undefined&&m.hisLn===choice.hisLn);if(matches.length!==1){exceptions.push({code:'CHOICE_IDENTITY_AMBIGUOUS',severity:'REVIEW_BEFORE_RELEASE'});continue;}const m=matches[0];if(choice.hisPdfExists!==undefined)m.hisPdfExists=choice.hisPdfExists;
 if(choice.classification&&choice.classification!==m.classification){let code:string|null=null;if(['PDF_REVIEW','CERTIFIED_RELEASED'].includes(choice.classification))code='PDF_EVIDENCE_REQUIRED';else if(!choice.reason?.trim())code='CLASSIFICATION_REASON_REQUIRED';else if(choice.classification==='QUALIFIED_PDF_PENDING'&&!analyses.some(a=>a.key===m.currentAnalysisKey&&a.adviceStatus==='QUALIFIED'))code='QUALIFIED_ANALYTIC_EVIDENCE_REQUIRED';else if(choice.classification==='RERUN'&&!analyses.some(a=>a.key===m.currentAnalysisKey&&a.adviceStatus==='RERUN'))code='RERUN_ANALYTIC_EVIDENCE_REQUIRED';else{m.classification=choice.classification;m.overrideReason=choice.reason;}
 if(code){const e:MigrationException={code,severity:'REVIEW_BEFORE_RELEASE',sourceKey:m.sourceKey,rowNumber:m.rowNumber};m.exceptions.push(e);exceptions.push(e);}}
 }
 const counts={mappingRows:mappings.length,validMappings:mappings.filter(m=>m.valid).length,analyses:analyses.length,runs:runs.length,noHalos:mappings.filter(m=>m.classification==='NO_HALOS').length,rerun:mappings.filter(m=>m.classification==='RERUN').length,qualifiedPdfPending:mappings.filter(m=>m.classification==='QUALIFIED_PDF_PENDING').length,hisPdfExists:mappings.filter(m=>m.hisPdfExists).length,exceptions:exceptions.length};
 const plan={version:1 as const,sources,mappings,analyses,runs,counts,exceptions,registryPairsSha256:registryPairsDigest(mappings),watermark:assessWatermark(input.watermark,mappings,parsed.source.sha256)};return {...plan,digest:hash(canonical(plan))};
}
export type MigrationPlan=ReturnType<typeof buildMigrationPlan>;


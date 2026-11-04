const FIRST_START=7701,STEP=100,COUNT=45,MAX_START=999901;

/** Installed UAT persists synthetic evidence, so every rerun needs a fresh, non-overlapping patient block. */
export function nextInstalledJourneyPatientStart(occupied:Iterable<number>,previouslyImported:Iterable<number>=[]){
 const used=new Set([...occupied,...previouslyImported]);
 for(let start=FIRST_START;start<=MAX_START;start+=STEP){
  let available=true;for(let n=start;n<start+COUNT;n++)if(used.has(n)){available=false;break;}
  if(available)return start;
 }
 throw Error('INSTALLED_JOURNEY_PATIENT_RANGE_EXHAUSTED');
}

import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {syntheticPet} from '../../packages/integrations/pet';
import {immutableWrite} from '../../packages/storage';
import {simulatorRoot} from '../../packages/integrations/scanner';
export async function generateSyntheticPairs(count=100,date=new Date()){if(count<1||count>1000)throw Error('INVALID_COUNT');await immutableWrite(simulatorRoot(),'.nipt-synthetic-root',Buffer.from('NIPT_SYNTHETIC_ONLY_V1'));await mkdir(path.join(simulatorRoot(),'outbound'),{recursive:true});const day=date.toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}).replace(/-/g,'');for(let i=0;i<count;i++){const p=syntheticPet(i);await immutableWrite(simulatorRoot(),`inbound/${day}/${p.filename}`,p.bytes);await immutableWrite(simulatorRoot(),`inbound/${day}/${p.filename.replace('.pet','.ok')}`,Buffer.alloc(0));}return count;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)generateSyntheticPairs().then(n=>console.log(JSON.stringify({code:'SYNTHETIC_PAIRS_CREATED',count:n}))).catch(()=>{process.stderr.write('SIMULATOR_FAILED\n');process.exitCode=1;});

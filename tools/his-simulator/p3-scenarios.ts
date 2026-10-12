// P3 demo scenarios on the synthetic simulator (plays HIS; never a real share). Writes into SIMULATOR_ROOT only.
// Use a SIMULATOR_ROOT separate from the P1 smoke root: these files include deliberately malformed and non-NIPT cases.
import {pathToFileURL} from 'node:url';
import {immutableWrite} from '../../packages/storage';
import {simulatorRoot} from '../../packages/integrations/scanner';
import {buildSyntheticPet,type SyntheticPetSpec} from '../../packages/inbound/wire';

export async function writeP3Scenarios(date=new Date()){
 const root=simulatorRoot(),day=date.toLocaleDateString('en-CA',{timeZone:'Asia/Bangkok'}).replace(/-/g,''),at=day+'090000';
 await immutableWrite(root,'.nipt-synthetic-root',Buffer.from('NIPT_SYNTHETIC_ONLY_V1'));
 const put=async(spec:SyntheticPetSpec,ok=true,bytes?:Buffer)=>{const p=buildSyntheticPet(spec);await immutableWrite(root,`inbound/${day}/${p.filename}`,bytes??p.bytes);if(ok)await immutableWrite(root,`inbound/${day}/${p.filename.replace('.pet','.ok')}`,Buffer.alloc(0));};
 // Seeded P1 cases 990000000001..3 (P1 identity scheme) already fail closed as IDENTITY_MISMATCH via `npm run simulator` pairs.
 // No case yet → UNLINKED (await ANC/Lab registration with blind entry).
 await put({ln:'990009000001',hn:'9900009001',receivedAt:at});await put({ln:'00990009000002',hn:'9900009002',receivedAt:at});
 // .pet without .ok → waiting, never read.
 await put({ln:'990009000003',hn:'9900009003',receivedAt:at},false);
 // Non-NIPT section and test code → counted only, never stored.
 await put({ln:'99000123456',hn:'9900009004',receivedAt:at,section:'60'});await put({ln:'990009000005',hn:'9900009005',receivedAt:at,testCode:'11111'});
 // Broken CP874 → ParseError with a stable code.
 const broken=buildSyntheticPet({ln:'990009000006',hn:'9900009006',receivedAt:at});await put({ln:'990009000006',hn:'9900009006',receivedAt:at},true,Buffer.concat([broken.bytes.subarray(0,60),Buffer.from([0xdb]),broken.bytes.subarray(61)]));
 return {day,files:6};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)writeP3Scenarios().then(r=>console.log(JSON.stringify({code:'P3_SYNTHETIC_SCENARIOS_WRITTEN',...r}))).catch(()=>{process.stderr.write('P3_SCENARIOS_FAILED\n');process.exitCode=1;});

import {readFile} from 'node:fs/promises';
import {NextResponse,type NextRequest} from 'next/server';
import {z} from 'zod';
import {withTransaction} from '../../../../../packages/db/connection';
import {registerP2} from '../../../../../packages/p2/service';
import {receiveEqaSpecimen} from '../../../../../packages/eqa/service';
import {readJson} from '../../../../server/http';
import {p2Mutation,noStore} from '../../../../server/p2/http';

/** Organizer-provided fictional identity; no invented HIS PET/HN/DOB. */
const schema=z.strictObject({
 ln:z.string().trim().regex(/^\d{10}$/),hn:z.string().trim().min(1).max(32),
 unitId:z.uuid(),identifierSource:z.enum(['TUBE_LABEL','REQUEST_FORM']),
 idempotencyKey:z.string().min(1).max(200),
 collectionDate:z.iso.date(),
 eqa:z.strictObject({
  organizer:z.string().trim().min(2).max(200),
  organizerSampleId:z.string().trim().min(1).max(120),
  patientName:z.string().trim().min(2).max(200),
  patientDob:z.iso.date().nullable().optional(),
  patientSex:z.enum(['F','M','U']).nullable().optional(),
  pregnancyType:z.enum(['Singleton','Twins']).nullable().optional(),
  edd:z.iso.date().nullable().optional(),
  collectionAt:z.iso.datetime({offset:true}).nullable().optional(),
  programYear:z.number().int().min(2000).max(2200),
  evidenceReference:z.string().trim().min(3).max(300)
 })
});
export async function POST(request:NextRequest){
 return p2Mutation(request,'EQA_REGISTER',async user=>{
  const input=schema.parse(await readJson(request));
  const key=await readFile(/* turbopackIgnore: true */ process.env.IDENTITY_LOOKUP_KEY_FILE??'');
  const result=await withTransaction(async db=>{
    const registered=await registerP2(db,user,{ln:input.ln,hn:input.hn,unitId:input.unitId,origin:'LAB_DIRECT',idempotencyKey:input.idempotencyKey,identifierSource:input.identifierSource,eqa:input.eqa},key);
    if(!registered.caseId)throw Error('EQA_REGISTRATION_FAILED');
    const received=await receiveEqaSpecimen(db,user,registered.caseId,input.collectionDate);
    return {...received,outcome:registered.outcome};
  });
  return NextResponse.json(result,{headers:noStore});
 });
}
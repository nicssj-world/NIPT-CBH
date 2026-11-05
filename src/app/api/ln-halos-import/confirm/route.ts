import {readFile} from 'node:fs/promises';
import path from 'node:path';
import type {NextRequest} from 'next/server';
import {assertDatabaseMode,pool} from '../../../../../packages/db/connection';
import {LabError} from '../../../../../packages/lab/core';
import {commitLnHalosImport} from '../../../../../packages/migration/ln-halos-commit';
import {matchStoredImportPets} from '../../../../../packages/migration/ln-halos-matching';
import {hash} from '../../../../../packages/migration/model';
import {FileStore} from '../../../../../packages/storage';
import {boundedMultipart} from '../../../../server/bounded-multipart';
import {migrationRequest} from '../../../../server/migration';

export const runtime='nodejs';

export async function POST(request:NextRequest){
 return migrationRequest(request,async user=>{
  const form=await boundedMultipart(request,8*1024*1024+65536),file=form.get('file');
  if(!(file instanceof File)||file.size===0||file.size>8*1024*1024)throw new LabError('MAPPING_FILE_REQUIRED',422);
  if(!process.env.FILE_STORE_ROOT||!process.env.IDENTITY_LOOKUP_KEY_FILE)throw new LabError('IMPORT_CONFIGURATION_REQUIRED',409);
  const bytes=Buffer.from(await file.arrayBuffer());
  if(form.get('sha256')!==hash(bytes))throw new LabError('MAPPING_CHANGED_SINCE_PREVIEW',409);
  const key=await readFile(process.env.IDENTITY_LOOKUP_KEY_FILE);
  if(key.length!==32)throw new LabError('IDENTITY_LOOKUP_KEY_INVALID',409);
  const store=new FileStore(path.resolve(process.env.FILE_STORE_ROOT)),fence=await pool().connect();
  try{
   await fence.query('SELECT pg_advisory_lock_shared(75432804)');
   await assertDatabaseMode(fence);
   const committed=await commitLnHalosImport(pool(),user,{name:file.name,bytes},{sourceFrozen:form.get('sourceFrozen')==='true'},{store});
   const matching=await matchStoredImportPets(pool(),user,committed.executionId,store,key);
   return {...committed,matching};
  }finally{try{await fence.query('SELECT pg_advisory_unlock_shared(75432804)');}finally{fence.release();}}
 });
}

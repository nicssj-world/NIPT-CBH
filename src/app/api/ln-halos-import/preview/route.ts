import type {NextRequest} from 'next/server';
import {pool} from '../../../../../packages/db/connection';
import {previewLnHalosImport} from '../../../../../packages/migration/ln-halos-import';
import {LabError} from '../../../../../packages/lab/core';
import {boundedMultipart} from '../../../../server/bounded-multipart';
import {migrationRequest} from '../../../../server/migration';

export const runtime='nodejs';

export async function POST(request:NextRequest){
 return migrationRequest(request,async()=>{
  const form=await boundedMultipart(request,8*1024*1024+65536),file=form.get('file');
  if(!(file instanceof File)||file.size===0||file.size>8*1024*1024)throw new LabError('MAPPING_FILE_REQUIRED',422);
  return previewLnHalosImport(pool(),{name:file.name,bytes:Buffer.from(await file.arrayBuffer())});
 });
}

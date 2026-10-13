import path from 'node:path';
import type {Queryable} from '../../packages/db/connection';
import type {Staff} from '../../packages/lab/core';
import {workspace} from '../../packages/sequencing/service';
import {FileStore} from '../../packages/storage';
import {requestF5Pdf} from '../../packages/pdf/f5';
export const f5Deps=()=>({store:new FileStore(path.resolve(/* turbopackIgnore: true */ process.env.FILE_STORE_ROOT||'data/files')),render:requestF5Pdf});
export async function sequencingWorkspace(db:Queryable,user:Staff,batchId:string){const w=await workspace(db,user,batchId);const id=w.current?.id;
 const documents=id?(await db.query<{id:string;kind:string;revision:number;file_sha256:string}>('SELECT id,kind,revision,file_sha256 FROM p4c_document WHERE dnb_id=$1 ORDER BY issued_at',[id])).rows:[];
 const copies=id?(await db.query<{id:string;kind:string;copy_number:number}>('SELECT c.id,c.kind,c.copy_number FROM p4c_document_copy c JOIN p4c_document d ON d.id=c.document_id WHERE d.dnb_id=$1 ORDER BY c.created_at',[id])).rows:[];
 return {...w,documents,copies};}

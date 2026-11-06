import {z} from 'zod';
import type {Queryable} from '../db/connection';
import {appendAudit} from '../db/audit';
import {authorize,type Principal} from '../security/policy';
import {transactional} from './tx';

export type ParseErrorReviewAction='delete'|'restore';
export class InboundFileReviewError extends Error{
 constructor(code:string,public status=409){super(code);}
}

/** Permanently remove a selected ParseError row while retaining its hash tombstone and audit trail. */
export async function reviewParseError(db:Queryable,user:Principal,fileId:string,action:ParseErrorReviewAction){
 const id=z.uuid().parse(fileId);
 if(!authorize(user,'his.scan',{},'write'))throw new InboundFileReviewError('FORBIDDEN',403);
 if(action==='delete'){
  let deleted:{deleted_file_id:string;sha256:string;source_path:string;ln:string;path_version:number;error_code:string|null};
  try{
   deleted=(await db.query<typeof deleted>('SELECT * FROM purge_his_inbound_parse_error($1,$2)',[id,user.id])).rows[0];
  }catch(error){
   const code=error instanceof Error?error.message:'';
   if(code==='INBOUND_FILE_NOT_FOUND')throw new InboundFileReviewError('INBOUND_FILE_NOT_FOUND',404);
   if(code==='PARSE_ERROR_ALREADY_SUPERSEDED')throw new InboundFileReviewError('PARSE_ERROR_ALREADY_CLOSED');
   if(code==='PARSE_ERROR_ALREADY_PURGED')throw new InboundFileReviewError('PARSE_ERROR_ALREADY_DELETED');
   if(code==='PARSE_ERROR_ONLY')throw new InboundFileReviewError('PARSE_ERROR_NOT_OPEN');
   throw error;
  }
  if(!deleted)throw new InboundFileReviewError('INBOUND_FILE_NOT_FOUND',404);
  await appendAudit(db,{actorId:user.id,action:'INBOUND_PARSE_ERROR_DELETED',resourceType:'his_inbound_file',resourceId:deleted.deleted_file_id,details:{
   outcome:'DELETED',reasonCode:deleted.error_code??'PARSE_ERROR',previousState:'ParseError',resultingState:'Deleted',synthetic:process.env.NIPT_MODE!=='operational'
  }});
  return {deleted:true};
 }
 const file=(await db.query<{id:string;state:string;error_code:string|null}>(
  'SELECT id,state,error_code FROM his_inbound_file WHERE id=$1 FOR UPDATE',[id]
 )).rows[0];
 if(!file)throw new InboundFileReviewError('INBOUND_FILE_NOT_FOUND',404);
 if(file.state!=='ParseError')throw new InboundFileReviewError('PARSE_ERROR_NOT_OPEN');
 const latest=(await db.query<{event:string}>(
  'SELECT event FROM his_inbound_file_event WHERE inbound_file_id=$1 ORDER BY sequence DESC LIMIT 1',[id]
 )).rows[0]?.event??null;
 const event='RESTORED';
 if(latest!=='DISMISSED')throw new InboundFileReviewError('PARSE_ERROR_NOT_RESTORABLE');
 await db.query('INSERT INTO his_inbound_file_event(inbound_file_id,event,actor_id,reason_code) VALUES($1,$2,$3,$4)',[
  id,event,user.id,'OPERATOR_ACTION'
 ]);
 await appendAudit(db,{actorId:user.id,action:'INBOUND_PARSE_ERROR_RESTORED',resourceType:'his_inbound_file',resourceId:id,details:{
  outcome:event,reasonCode:file.error_code??'PARSE_ERROR',previousState:'ParseError',resultingState:'ParseError',synthetic:process.env.NIPT_MODE!=='operational'
 }});
 return {event};
}

/**
 * Mark earlier parse failures and purge tombstones as superseded only after a parsed row
 * from the same path and LN exists; an unresolved tombstone keeps registration blocked.
 */
export async function supersedeParseErrors(db:Queryable,sourcePath:string,ln:string,newerPathVersion:number){
 return transactional(db)(async tx=>{
  const errors=(await tx.query<{id:string;error_code:string|null}>(
   `SELECT f.id,f.error_code FROM his_inbound_file f
    WHERE f.state='ParseError' AND f.source_path=$1 AND f.ln=$2 AND f.path_version<$3
     AND (EXISTS(SELECT 1 FROM his_inbound_file replacement
       WHERE replacement.source_path=f.source_path AND replacement.ln=f.ln
        AND replacement.path_version>f.path_version AND replacement.state<>'ParseError')
      OR EXISTS(SELECT 1 FROM his_inbound_source sighting
       JOIN his_inbound_file replacement ON replacement.id=sighting.inbound_file_id AND replacement.sha256=sighting.sha256
       WHERE sighting.source_path=f.source_path AND sighting.first_seen_at>f.discovered_at
        AND replacement.ln=f.ln AND replacement.state<>'ParseError'))
    ORDER BY f.path_version,f.id FOR UPDATE`,[sourcePath,ln,newerPathVersion]
  )).rows;
  for(const file of errors){
   const latest=(await tx.query<{event:string}>(
    'SELECT event FROM his_inbound_file_event WHERE inbound_file_id=$1 ORDER BY sequence DESC LIMIT 1',[file.id]
   )).rows[0]?.event;
   if(latest==='SUPERSEDED')continue;
   await tx.query('INSERT INTO his_inbound_file_event(inbound_file_id,event,actor_id,reason_code) VALUES($1,\'SUPERSEDED\',NULL,\'VALID_REPLACEMENT\')',[file.id]);
   await appendAudit(tx,{action:'INBOUND_PARSE_ERROR_SUPERSEDED',resourceType:'his_inbound_file',resourceId:file.id,details:{
    outcome:'SUPERSEDED',reasonCode:file.error_code??'PARSE_ERROR',previousState:'ParseError',resultingState:'ParseError',synthetic:process.env.NIPT_MODE!=='operational'
   }});
  }
  const purged=(await tx.query<{sha256:string;deleted_file_id:string}>(
   `SELECT p.sha256,p.deleted_file_id FROM his_inbound_file_purge p
    WHERE p.source_path=$1 AND p.ln=$2 AND p.path_version<$3
     AND NOT EXISTS(SELECT 1 FROM his_inbound_file_purge_event e WHERE e.sha256=p.sha256)
     AND (EXISTS(SELECT 1 FROM his_inbound_file replacement
       WHERE replacement.source_path=p.source_path AND replacement.ln=p.ln
        AND replacement.path_version>p.path_version AND replacement.state<>'ParseError')
      OR EXISTS(SELECT 1 FROM his_inbound_source sighting
       JOIN his_inbound_file replacement ON replacement.id=sighting.inbound_file_id AND replacement.sha256=sighting.sha256
       WHERE sighting.source_path=p.source_path AND sighting.first_seen_at>p.created_at
        AND replacement.ln=p.ln AND replacement.state<>'ParseError'))
    ORDER BY p.path_version,p.sha256`,[sourcePath,ln,newerPathVersion]
  )).rows;
  for(const file of purged){
   const inserted=await tx.query("INSERT INTO his_inbound_file_purge_event(sha256,event) VALUES($1,'SUPERSEDED') ON CONFLICT DO NOTHING RETURNING sha256",[file.sha256]);
   if(!inserted.rows.length)continue;
   await appendAudit(tx,{action:'INBOUND_PARSE_ERROR_SUPERSEDED',resourceType:'his_inbound_file_purge',resourceId:file.deleted_file_id,details:{
    outcome:'SUPERSEDED',reasonCode:'VALID_REPLACEMENT',previousState:'ParseError',resultingState:'Replaced',synthetic:process.env.NIPT_MODE!=='operational'
   }});
  }
  return errors.length+purged.length;
 });
}

import type {Queryable} from '../db/connection';
import {need,assertSession,audit,uuid,LabError,type Staff} from '../lab/core';
import {z} from 'zod';
import {fillReport,DocxError,type SignerSlot} from './docx';
import {renderDocxBatch} from './native-word';
import {masterBytes,watermark,type ReportDeps} from './reports';
import {signatureImage} from './signers';
import {syntheticValues} from './template-registry';

/**
 * Sample report for the administrator who is about to verify a signer profile: the real master (Singleton 17-07 or Twin 17-08) with
 * synthetic values and this signer in BOTH signature slots, watermarked PREVIEW. Never stored as a report; the PDF is only returned.
 * Same authority as verifying the profile (user.manage).
 */
export async function signerSamplePreview(db:Queryable,user:Staff,deps:ReportDeps&{render?:ReportDeps['render']},input:unknown){
 await assertSession(db,user);need(user,'user.manage');
 const d=z.strictObject({profileId:uuid,kind:z.enum(['SINGLETON','TWIN'])}).parse(input);
 const p=(await db.query<{legal_name:string;mt_license_no:string;signature_sha256:string}>('SELECT legal_name,mt_license_no,signature_sha256 FROM report_signer_profile WHERE id=$1',[d.profileId])).rows[0];
 if(!p)throw new LabError('NOT_FOUND',404);
 const master=await masterBytes(db,deps,d.kind);if(!master)throw new LabError('REPORT_MASTER_NOT_INSTALLED',409);
 const bytes=await deps.store.get(p.signature_sha256),img=signatureImage(bytes);
 const slot:SignerSlot={name:p.legal_name,license:p.mt_license_no,date:'01-Jan-2026',signature:{bytes,media:img.media,width:img.width,height:img.height}};
 let docx;try{docx=fillReport(master.bytes,d.kind,syntheticValues(),{reported:slot,approved:slot},{sha256:master.sha256,code:master.code});}catch(e){if(e instanceof DocxError)throw new LabError(e.message,409,e.details);throw e;}
 let pdf;try{[pdf]=await(deps.render??renderDocxBatch)([{id:'signer-sample',docx:docx.bytes}]);}
 catch(e){throw new LabError(e instanceof Error&&e.message==='REPORT_NATIVE_WORD_WINDOWS_REQUIRED'?'REPORT_RENDER_UNAVAILABLE':'REPORT_PREVIEW_RENDER_FAILED',409);}
 await audit(db,user,'SIGNER_SAMPLE_PREVIEWED','REPORT_SIGNER_PROFILE',d.profileId,{outcome:d.kind});
 return {bytes:await watermark(pdf.bytes),pages:pdf.pages,templateCode:master.code};
}

/** True when both sample previews can be produced here. Only when false may an administrator verify without looking (recorded as not previewed). */
export async function previewPossible(db:Queryable,deps:ReportDeps){
 if(process.platform!=='win32'&&!deps.render)return false;
 for(const kind of ['SINGLETON','TWIN'] as const)if(!await masterBytes(db,deps,kind))return false;
 return true;
}

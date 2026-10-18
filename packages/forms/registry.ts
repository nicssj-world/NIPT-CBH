import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {z} from 'zod';

// ANC Request (Fm-WI-T-BM17/01) and Consent (Fm-WI-T-BM17/02) template sets. The DCC PDFs are installation assets, never committed
// or edited: an installation registry (NIPT_ANC_FORM_REGISTRY, JSON) names the files, and every use re-checks their SHA-256.
// The active set is chosen by Settings request_consent.templateVersion (OD-06 consumer). A set is only usable when its layout
// (the field coordinates in layout.ts) is known; a new DCC revision with moved fields needs a new layout, not a silent reuse.
export const KNOWN_LAYOUTS=['BM17-2026-10'] as const;
/** The Owner-supplied reference PDFs (NIPT-Audit, 2026-10-18). Pinned so a registry cannot swap other bytes in under this id. */
export const REFERENCE_SET_ID='CBH-BM17-REF-2026-10-18';
const PINNED:Record<string,{request:string;consent:string}>={
 [REFERENCE_SET_ID]:{request:'c5b2bfce72f64ba80d06967575fd17364aa98bb5a37c5032d2d3dbaeedb9511b',consent:'dc791bb8f40ccc0b895d4f9171f81950738cceb28b57bb056111b97f3c3f0332'},
};
const fileSchema=z.strictObject({path:z.string().min(1).max(1000),sha256:z.string().regex(/^[a-f0-9]{64}$/),docCode:z.string().min(1).max(40),page:z.string().regex(/^\d+ \/ \d+$/)});
const setSchema=z.strictObject({id:z.string().regex(/^[A-Z0-9][A-Z0-9-]{2,63}$/),label:z.string().min(1).max(120),layout:z.enum(KNOWN_LAYOUTS),
 dccStatus:z.enum(['REFERENCE_NOT_DCC_APPROVED','DCC_APPROVED']),request:fileSchema,consent:fileSchema});
const registrySchema=z.strictObject({version:z.literal(1),sets:z.array(setSchema).min(1).max(50)});
export type TemplateSet=z.infer<typeof setSchema>;
export type LoadedTemplates={set:TemplateSet;request:Buffer;consent:Buffer};

export async function readRegistry(){
 const file=process.env.NIPT_ANC_FORM_REGISTRY;if(!file)throw Error('FORM_TEMPLATES_NOT_INSTALLED');
 let text:string;try{text=await readFile(file,'utf8');}catch{throw Error('FORM_TEMPLATES_NOT_INSTALLED');}
 let raw:unknown;try{raw=JSON.parse(text);}catch{throw Error('FORM_TEMPLATE_REGISTRY_INVALID');}
 const parsed=registrySchema.safeParse(raw);if(!parsed.success)throw Error('FORM_TEMPLATE_REGISTRY_INVALID');
 const dir=path.dirname(path.resolve(file));
 return parsed.data.sets.map(s=>({...s,request:{...s.request,path:path.resolve(dir,s.request.path)},consent:{...s.consent,path:path.resolve(dir,s.consent.path)}}));
}
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
/** Loads one set and proves the bytes: registered hash, pinned hash for the reference id, PDF magic. */
export async function loadTemplates(id:string):Promise<LoadedTemplates>{
 const set=(await readRegistry()).find(s=>s.id===id);if(!set)throw Error('FORM_TEMPLATE_NOT_FOUND');
 const pinned=PINNED[id];if(pinned&&(pinned.request!==set.request.sha256||pinned.consent!==set.consent.sha256))throw Error('FORM_TEMPLATE_HASH_MISMATCH');
 const read=async(f:TemplateSet['request'])=>{let b:Buffer;try{b=await readFile(f.path);}catch{throw Error('FORM_TEMPLATE_FILE_MISSING');}
  if(sha(b)!==f.sha256)throw Error('FORM_TEMPLATE_HASH_MISMATCH');if(!b.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('FORM_TEMPLATE_NOT_PDF');return b;};
 return {set,request:await read(set.request),consent:await read(set.consent)};
}
/** Settings validation for request_consent.templateVersion: the set must exist, verify and have a known layout. */
export async function formTemplateSettingValid(value:unknown){
 try{await loadTemplates(String((value as {templateVersion?:unknown})?.templateVersion??''));return true;}catch{return false;}
}

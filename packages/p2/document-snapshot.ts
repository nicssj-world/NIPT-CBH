import type {Queryable} from '../db/connection';
import type {Staff} from './service';
import {formSources,requestFields,consentFields} from './forms';
import {loadTemplates} from '../forms/registry';
import {readActiveSettings} from '../settings/service';
import {SETTINGS} from '../settings/catalog';
import {DCC_CONSENT} from '../forms/consent-content';
/** Freeze mapping and exact template hashes at issue time. Rendering never reads a later workspace/doctor revision. */
export async function freezeDccForm(db:Queryable,user:Staff,caseId:string,kind:'REQUEST'|'CONSENT'){
 const setting=SETTINGS.request_consent.schema.parse((await readActiveSettings(db)).request_consent??SETTINGS.request_consent.default);
 const t=await loadTemplates(setting.templateVersion);
 if(kind==='CONSENT'&&t.set.consent.sha256!==DCC_CONSENT.sourcePdfSha256)throw Error('CONSENT_TEMPLATE_CONTENT_UNSUPPORTED');
 const source=await formSources(db,user,caseId);
 const formFields=kind==='REQUEST'?requestFields(source).fields:{...consentFields(source).fields,acknowledged:Array(12).fill(false),decision:null,patientSignedDate:null};
 return {dcc:{id:t.set.id,layout:t.set.layout,dccStatus:t.set.dccStatus,requestSha256:t.set.request.sha256,consentSha256:t.set.consent.sha256},formFields};
}

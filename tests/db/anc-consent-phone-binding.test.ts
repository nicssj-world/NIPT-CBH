import {beforeAll,afterAll,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {migrate} from '../../tools/migrate';
let db:PGlite;
beforeAll(async()=>{db=new PGlite();await migrate(db);},120000);
afterAll(async()=>{await db?.close();});
const original={patient:{syntheticName:'SYNTHETIC original',dob:'1989-05-15'},ordering:{phone:null,coordinator:'SYNTHETIC nurse'},pregnancy:{edd:'2027-04-15',collectionDate:'2026-10-25'},history:{cancerTreatment:'No'}};
async function matches(payload:unknown,draft:unknown,version=21){return (await db.query<{matches:boolean}>('SELECT p2_consent_workspace_matches($1::jsonb,$2::jsonb,$3) matches',[JSON.stringify(payload),JSON.stringify(draft),version])).rows[0].matches;}
it('accepts only actual coordinator phone diff under the completed original consent',async()=>{const draft=structuredClone(original);draft.ordering.phone='1467' as never;expect(await matches({workspaceVersion:20,requestDraft:original},draft)).toBe(true);expect(await matches({workspaceVersion:21,requestDraft:draft},draft)).toBe(true);});
it('retains HOLD for material change even when phone also changes',async()=>{for(const path of ['dob','edd','coordinator','history']){const draft=structuredClone(original);draft.ordering.phone='1467' as never;if(path==='dob')draft.patient.dob='1990-01-01';if(path==='edd')draft.pregnancy.edd='2027-04-16';if(path==='coordinator')draft.ordering.coordinator='SYNTHETIC other';if(path==='history')draft.history.cancerTreatment='Yes';expect(await matches({workspaceVersion:20,requestDraft:original},draft)).toBe(false);}});
it('fails closed when no real phone diff, missing comparison snapshot, or malformed phone',async()=>{expect(await matches({workspaceVersion:20,requestDraft:original},original)).toBe(false);expect(await matches({workspaceVersion:20},{ordering:{phone:'1467'}})).toBe(false);expect(await matches({workspaceVersion:20,requestDraft:original},{...original,ordering:{...original.ordering,phone:1467}})).toBe(false);expect(await matches(null,original)).toBe(false);});
it('fails closed for missing, string, or future signed workspace versions',async()=>{const current={...original,ordering:{...original.ordering,phone:'1467'}};for(const version of [undefined,'20',22])expect(await matches({workspaceVersion:version,requestDraft:original},current)).toBe(false);});

import {it,expect} from 'vitest';
import {testDatabase} from '../helpers/database';

// Owner 2026-11-03: nobody needs a second name. Migration 192 cuts only the "must be a different person" condition out of each installed guard.
// This reads the installed definitions: the self checks are gone and the conditions that protect the record are still there.
const GUARDS:{fn:string;gone:RegExp[];kept:string[]}[]=[
 {fn:'his_intake_event_guard',gone:[/SECOND_PERSON_REQUIRED/],kept:['RESOLUTION_PROPOSAL_REQUIRED','RESOLUTION_MISMATCH']},
 {fn:'p5_link_event_guard',gone:[/SECOND_PERSON_REQUIRED/],kept:['LINK_PROPOSAL_REQUIRED','LINK_APPROVAL_MISMATCH']},
 {fn:'historical_verification_guard',gone:[/HISTORICAL_SELF_VERIFICATION/],kept:['HISTORICAL_VERIFICATION_STALE','HISTORICAL_VERIFIER_ROLE_REQUIRED']},
 {fn:'p2_doctor_approval_guard',gone:[/MAKER_CHECKER_REQUIRED/],kept:[]},
 {fn:'p4_review_guard',gone:[/SECOND_PERSON_REQUIRED/],kept:['OBSERVATION_NOT_PENDING']},
 {fn:'p4b_review_guard',gone:[/SECOND_PERSON_REQUIRED/],kept:['OBSERVATION_SUPERSEDED']},
 {fn:'p4c_qc4_review_guard',gone:[/SECOND_PERSON_REQUIRED/],kept:['QC4_NOT_CURRENT']},
 {fn:'p4c_review_guard',gone:[/SECOND_PERSON_REQUIRED/],kept:['OBSERVATION_NOT_CURRENT']},
 {fn:'p4c_verification_guard',gone:[/SECOND_PERSON_REQUIRED/],kept:['TRANSFER_NOT_CURRENT']},
 {fn:'settings_activation_guard',gone:[/approved_bys*=s*r.created_by/],kept:['SETTING_APPROVAL_REQUIRED']},
 {fn:'report_template_active_guard',gone:[/approved_by\s*=\s*r\.created_by/],kept:['REPORT_TEMPLATE_APPROVAL_REQUIRED','REPORT_TEMPLATE_KIND_MISMATCH','test_passed']},   // migration 211
 {fn:'task3_signer_event_guard',gone:[/NEW\.actor_id\s*=\s*p\.user_id/],kept:['SIGNER_VERIFICATION_INVALID','SIGNER_ALREADY_REVOKED']},   // migration 212
 {fn:'lab_bench_review_guard',gone:[/created_by\s*<>\s*NEW\.reviewer_id/],kept:['OWNER_WORKSHEET_MEASUREMENTS_AND_PEER_REVIEW_REQUIRED','lab_bench_revision_sha']},
 {fn:'p4b_qc2_guard',gone:[/recorded_by\s*<>\s*NEW\.actor_id/],kept:["r.result='Confirmed'",'QC2_VERIFIED_EVIDENCE_REQUIRED']},
 {fn:'p4c_qc3_guard',gone:[/recorded_by\s*<>\s*NEW\.actor_id/],kept:["r.result='Confirmed'",'QC3_VERIFIED_EVIDENCE_REQUIRED']}
];
it('every second-person guard lost its self check and kept the rest',async()=>{
 const db=await testDatabase();
 try{
  for(const g of GUARDS){
   const src=(await db.query<{s:string}>("SELECT prosrc s FROM pg_proc WHERE proname=$1 AND pronamespace='public'::regnamespace",[g.fn])).rows[0]?.s;
   expect(src,g.fn).toBeDefined();
   for(const re of g.gone)expect(src,`${g.fn} still ${re}`).not.toMatch(re);
   for(const k of g.kept)expect(src,`${g.fn} lost ${k}`).toContain(k);
  }
  expect((await db.query("SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosrc ~ 'RAISE EXCEPTION ''(SECOND_PERSON_REQUIRED|HISTORICAL_SELF_VERIFICATION|MAKER_CHECKER_REQUIRED)'''")).rows).toHaveLength(0);
 }finally{await db.close();}
},120000);

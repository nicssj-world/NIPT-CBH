import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const read=(p:string)=>readFileSync(p,'utf8');
it('no screen or service still demands a second name or a typed reason for the flows the owner simplified',()=>{
 const del=read('src/components/quality-control/eqa-delete-button.tsx');
 expect(del).not.toContain('เหตุผล');                                                         // EQA delete: one confirmation
 expect(del).toContain('"/api/eqa/delete",{caseId}');
 for(const f of ['packages/lab/bench-review.ts','packages/lab/records.ts','packages/pooling/service.ts','packages/sequencing/service.ts','packages/readygen/template-registry.ts','packages/readygen/signers.ts','packages/p2/service.ts','packages/historical/lifecycle.ts'])
  expect(read(f),f).not.toMatch(/SECOND_PERSON_REQUIRED|MAKER_CHECKER_REQUIRED|SELF_VERIFICATION_PROHIBITED/);
 expect(read('packages/security/policy.ts')).not.toContain('resource.actorId === user.id');   // no self-approval denial in the central rule
 const migration=read('db/migrations/192_single_person_workflow.sql');
 expect(migration).toContain('SINGLE_PERSON_GUARD_REMAINS');                                  // the migration proves no second-person guard is left
});

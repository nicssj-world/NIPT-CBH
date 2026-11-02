import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyChange,withPendingMigrations} from '../../deploy/windows/risk-classification.mjs';
const level=paths=>classifyChange({files:paths.map(path=>({status:'M',path}))}).level;
test('presentation-only changes are LOW',()=>{
 assert.equal(level(['src/components/p2/case-workspace.tsx']),'LOW');
 assert.equal(level(['src/components/anc/dashboard.css','docs/deployment/GUIDE.md','tests/unit/x.test.ts']),'LOW');
 assert.equal(level(['src/app/(protected)/cases/page.tsx']),'LOW');
});
test('PDF, report and dashboard changes are MEDIUM',()=>{
 assert.equal(level(['packages/anc/service.ts']),'MEDIUM');
 assert.equal(level(['packages/pdf/render.ts','src/components/p2/shared.tsx']),'MEDIUM');
 assert.equal(level(['packages/readygen/filename.ts']),'MEDIUM');
});
test('database, identity, results, HIS, authentication, migration and the deployment engine are HIGH',()=>{
 for(const p of ['db/migrations/179_x.sql','packages/db/roles.sql','packages/p2/service.ts','packages/results/service.ts','packages/integrations/pet.ts','packages/inbound/wire.ts',
  'packages/security/policy.ts','src/proxy.ts','packages/migration/pdf-identity.ts','tools/win-installer/nipt-admin.mjs','deploy/windows/deploy-production.ps1','package.json','package-lock.json',
  'packages/lab/core.ts','packages/readygen/interpretation.ts','src/app/api/p5/releases/[id]/file/route.ts'])assert.equal(level([p]),'HIGH',p);
});
test('the highest level of any file wins, so a UI file next to a clinical one is HIGH',()=>{
 assert.equal(level(['src/components/p2/shared.tsx','packages/results/service.ts']),'HIGH');
 assert.equal(level(['src/components/p2/shared.tsx','packages/anc/model.ts']),'MEDIUM');
});
test('a migration file is HIGH wherever it sits, and an unrecognised file is HIGH with its reason',()=>{
 assert.equal(level(['src/components/p2/migrations/001_x.sql']),'HIGH');
 const r=classifyChange({files:[{path:'something/new/thing.bin'}]});
 assert.equal(r.level,'HIGH');assert.match(r.reasons[0].rule,/not recognised/);
});
test('no known difference is HIGH, and renaming a path cannot lower it',()=>{
 assert.equal(classifyChange({files:[]}).level,'HIGH');
 assert.equal(level(['packages\\results\\service.ts']),'HIGH');
 assert.equal(level(['./packages/results/service.ts']),'HIGH');
});
test('pending migrations in the package force HIGH even when the paths look harmless',()=>{
 const low=classifyChange({files:[{path:'src/components/p2/shared.tsx'}]});
 assert.equal(low.level,'LOW');
 const high=withPendingMigrations(low,['179_x.sql']);
 assert.equal(high.level,'HIGH');assert.equal(high.requires.stagingVerification,true);
 assert.equal(withPendingMigrations(low,[]).level,'LOW');
});
test('HIGH requires Staging verification; LOW and MEDIUM require focused validation and the same backup and confirmation',()=>{
 const l=classifyChange({files:[{path:'src/components/p2/shared.tsx'}]}),m=classifyChange({files:[{path:'packages/anc/model.ts'}]}),h=classifyChange({files:[{path:'db/migrations/1_x.sql'}]});
 assert.equal(l.requires.stagingVerification,false);assert.equal(m.requires.stagingVerification,false);assert.equal(h.requires.stagingVerification,true);
 assert.ok(m.requires.focusedValidation.length>l.requires.focusedValidation.length);
 for(const r of [l,m,h]){assert.equal(r.requires.verifiedPreUpgradeBackup,true);assert.equal(r.requires.confirmation,'one typed confirmation');}
});

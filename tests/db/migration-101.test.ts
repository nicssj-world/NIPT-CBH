import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {migrate} from '../../tools/migrate';

// Migration 101 (Owner correction "SIMPLIFY PAPER CONSENT", approved 2026-10-18; forward only, isolated synthetic databases only):
// replaces only p2_clinical_documents_ready. 088 stays as recorded; the paper Request and Electronic Consent branches are unchanged.
it('101 upgrades a 100 database by replacing only the document readiness function',async()=>{
 const all=(await readdir('db/migrations')).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
 expect(all).toContain('101_p2_paper_consent_marker.sql');
 const before=await mkdtemp(path.join(tmpdir(),'nipt-mig-100-'));const db=new PGlite();
 try{
  for(const f of all.filter(f=>f<'101'))await copyFile(path.join('db/migrations',f),path.join(before,f));
  await migrate(db,before);
  const body=async()=>(await db.query<{src:string}>("SELECT prosrc src FROM pg_proc WHERE proname='p2_clinical_documents_ready'")).rows[0].src;
  const old=await body();expect(old).toContain("x#>>'{paperConsent,status}'='Verified' AND x#>>'{paperConsent,panel,decision}'='Granted'");
  const functions=async()=>(await db.query<{proname:string;src:string}>("SELECT proname,prosrc src FROM pg_proc WHERE proname LIKE 'p2\\_%' ORDER BY proname")).rows;
  const pre=await functions();
  await migrate(db);
  const ledger=(await db.query<{name:string;checksum:string}>("SELECT name,checksum FROM schema_migration WHERE name IN ('088_p2_operational_clinical_review.sql','101_p2_paper_consent_marker.sql') ORDER BY name")).rows;
  const sha=(f:string)=>createHash('sha256').update(readFileSync(path.join('db/migrations',f),'utf8')).digest('hex');
  expect(ledger).toEqual([{name:'088_p2_operational_clinical_review.sql',checksum:sha('088_p2_operational_clinical_review.sql')},{name:'101_p2_paper_consent_marker.sql',checksum:sha('101_p2_paper_consent_marker.sql')}]);
  const now=await body();
  expect(now).toContain("x->>'consentMode'='Paper'");expect(now).not.toContain("x#>>'{paperConsent,panel,decision}'='Granted'");
  // Request and Electronic Consent branches are byte-identical to 088.
  for(const branch of ["ELSE x#>>'{paperRequest,status}'='Verified' END","x#>>'{finalConsent,payload,signature,decision}'='Granted' AND x#>'{consentDocument,payload,workspaceVersion}'=x->'workspaceVersion'"]){expect(old).toContain(branch);expect(now).toContain(branch);}
  expect((await functions()).filter(f=>f.proname!=='p2_clinical_documents_ready')).toEqual(pre.filter(f=>f.proname!=='p2_clinical_documents_ready'));
 }finally{await db.close();await rm(before,{recursive:true,force:true});}
});

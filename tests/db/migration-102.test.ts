import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {migrate} from '../../tools/migrate';

// Migration 102 (Owner decision "Final Consent Owner Decisions", forward only, isolated synthetic databases only): adds
// p2_consent_latest_decision and replaces p2_clinical_documents_ready once more. 088 and 101 stay as recorded.
it('102 upgrades a 101 database: new decision function, refusal-aware readiness, Request and Electronic branches unchanged',async()=>{
 const all=(await readdir('db/migrations')).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
 expect(all).toContain('102_p2_paper_consent_refusal.sql');
 const before=await mkdtemp(path.join(tmpdir(),'nipt-mig-101-'));const db=new PGlite();
 try{
  for(const f of all.filter(f=>f<'102'))await copyFile(path.join('db/migrations',f),path.join(before,f));
  await migrate(db,before);
  const body=async(name:string)=>(await db.query<{src:string}>('SELECT prosrc src FROM pg_proc WHERE proname=$1',[name])).rows[0]?.src;
  const old=await body('p2_clinical_documents_ready');expect(old).toMatch(/consentMode'='Paper'\s+AND COALESCE/);expect(await body('p2_consent_latest_decision')).toBeUndefined();
  const others=async()=>(await db.query<{proname:string;src:string}>("SELECT proname,prosrc src FROM pg_proc WHERE proname LIKE 'p2\_%' AND proname NOT IN ('p2_clinical_documents_ready','p2_consent_latest_decision') ORDER BY proname")).rows;
  const pre=await others();
  await migrate(db);
  const sha=(f:string)=>createHash('sha256').update(readFileSync(path.join('db/migrations',f),'utf8')).digest('hex');
  expect((await db.query<{name:string;checksum:string}>("SELECT name,checksum FROM schema_migration WHERE name IN ('088_p2_operational_clinical_review.sql','101_p2_paper_consent_marker.sql','102_p2_paper_consent_refusal.sql') ORDER BY name")).rows)
   .toEqual(['088_p2_operational_clinical_review.sql','101_p2_paper_consent_marker.sql','102_p2_paper_consent_refusal.sql'].map(name=>({name,checksum:sha(name)})));
  const now=await body('p2_clinical_documents_ready'),decision=await body('p2_consent_latest_decision');
  expect(now).toContain("COALESCE(p2_consent_latest_decision(target),'')<>'Declined'");expect(now).toContain("x->>'consentMode'='Paper' END");
  for(const branch of ["ELSE x#>>'{paperRequest,status}'='Verified' END","x#>>'{finalConsent,payload,signature,decision}'='Granted' AND x#>'{consentDocument,payload,workspaceVersion}'=x->'workspaceVersion'"]){expect(old).toContain(branch);expect(now).toContain(branch);}
  expect(decision).toContain("status='Declined'");expect(decision).toContain("x.decision ASC"); // a tie resolves to Declined
  expect(await others()).toEqual(pre);
 }finally{await db.close();await rm(before,{recursive:true,force:true});}
});

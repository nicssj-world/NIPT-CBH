import {it,expect} from 'vitest';
import {Client} from 'pg';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase,type Queryable} from '../../packages/db/connection';
import {labUsers,tx} from '../helpers/lab';
import {writePet} from '../helpers/inbound';
import {runInboundCycle} from '../../packages/inbound/cycle';
import {FileStore} from '../../packages/storage';
import {lookupRegistrationPet,registerFromPet} from '../../packages/p2/pet-registration';
import {getCase,saveLabClinicalMetadata} from '../../packages/p2/service';
import {previewLabels,printLabels} from '../../packages/lab/intake';

it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('Task15 native roles: concurrent same-PET registration, monthly sequence, immutable markers and real label PDF readback',async()=>{
 const target=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(target);const url=new URL(target),name='nipt_synthetic_task15_'+randomBytes(5).toString('hex');url.pathname='/postgres';
 const admin=new Client({connectionString:url.toString()});await admin.connect();await admin.query('CREATE DATABASE '+name);url.pathname='/'+name;
 const owner=new Client({connectionString:url.toString()}),one=new Client({connectionString:url.toString()}),two=new Client({connectionString:url.toString()});
 const root=await mkdtemp(path.join(os.tmpdir(),'nipt-task15-native-')),simulator=path.join(root,'simulator'),store=new FileStore(path.join(root,'files')),lookupKey=randomBytes(32),out=path.resolve('.local/integration-evidence/task15-native');await mkdir(out,{recursive:true});
 try{
  process.env.NIPT_MODE='synthetic';await owner.connect();await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));await one.connect();await two.connect();await one.query('SET ROLE app_rw');await two.query('SET ROLE app_rw');
  const users=await labUsers(owner as Queryable),deps={root:simulator,store,lookupKey};await mkdir(path.join(simulator,'inbound'),{recursive:true});await writeFile(path.join(simulator,'.nipt-synthetic-root'),'NIPT_SYNTHETIC_ONLY_V1');
  const values=[['990001010001','9900010101','20260830090102'],['990001010002','9900010102','20260831090102'],['990001010003','9900010103','20260901090102']];
  for(const [ln,hn,receivedAt] of values)await writePet(simulator,'20261020',{ln,hn,receivedAt,ward:'SYNTHETIC-NATIVE-WARD'});
  await runInboundCycle({query:owner.query.bind(owner)},deps,{trigger:'MANUAL',lookbackDays:3,intervalSeconds:30,now:()=>new Date('2026-10-20T05:00:00Z')});
  const ln=values[0][0],input={ln,unitId:users.unit,consentMode:'Paper',idempotencyKey:randomUUID()};
  const pair=await Promise.all([tx(one,db=>registerFromPet(db,users.staff,input,deps)),tx(two,db=>registerFromPet(db,users.staff,{...input,idempotencyKey:randomUUID()},deps))]);expect(pair[0].caseId).toBe(pair[1].caseId);
  expect((await owner.query('SELECT count(*)::int n FROM specimen_lab_number')).rows[0].n).toBe(1);expect((await owner.query('SELECT count(*)::int n FROM lab_operational_registration')).rows[0].n).toBe(1);
  for(const [nextLn] of values.slice(1))await tx(one,db=>registerFromPet(db,users.staff,{...input,ln:nextLn,idempotencyKey:randomUUID()},deps));
  const numbers=(await owner.query('SELECT l.ln,n.ln_halos,n.sequence_value,r.received_at FROM specimen_lab_number n JOIN specimen_round r ON r.id=n.round_id JOIN case_ln l ON l.id=r.case_ln_id ORDER BY l.ln')).rows;
  // The approved issuer uses the Bangkok allocation calendar, while receipt keeps the actual PET event clock.
  expect(numbers.map(x=>x.sequence_value)).toEqual([1,2,3]);expect(new Date(numbers[0].received_at).toISOString()).toBe('2026-08-30T02:01:02.000Z');
  const months=(await owner.query(`SELECT p4_ln_halos_month('2026-08-30'::date)::text day_a,p4_ln_halos_month('2026-08-31'::date)::text day_b,p4_ln_halos_month('2026-09-01'::date)::text next_month`)).rows[0];expect(months).toEqual({day_a:'2026-08-01',day_b:'2026-08-01',next_month:'2026-09-01'});
  const caseId=pair[0].caseId!,detail=await tx(one,db=>getCase(db,users.staff,caseId));
  await expect(tx(one,db=>previewLabels(db,users.staff,{roundIds:[detail.case.current_round_id],includeName:false}))).rejects.toMatchObject({code:'PREGNANCY_TYPE_UNCONFIRMED'});
  await tx(one,db=>saveLabClinicalMetadata(db,users.staff,caseId,{expectedVersion:detail.workspace.version,edd:'2027-03-01',pregnancy:'Singleton'}));expect((await owner.query('SELECT lab_owner_paper_ready($1) ready',[detail.case.current_round_id])).rows[0].ready).toBe(true);
  const label=await tx(one,db=>printLabels(db,users.staff,{roundIds:[detail.case.current_round_id],includeName:false}));
  const browser=await chromium.launch();let pdf:Buffer;try{const page=await browser.newPage();await page.setContent(label.html);pdf=await page.pdf({format:'A4',printBackground:true});}finally{await browser.close();}
  const loading=getDocument({data:new Uint8Array(pdf!),useSystemFonts:true}),document=await loading.promise;let text='';for(let n=1;n<=document.numPages;n++){const p=await document.getPage(n);text+=(await p.getTextContent()).items.map(x=>'str' in x?x.str:'').join(' ');}await loading.destroy();
  expect(text).toContain(ln);expect(text).toContain(numbers[0].ln_halos);await writeFile(path.join(out,'labels.pdf'),pdf!);
  await expect(tx(one,db=>db.query('UPDATE lab_operational_registration SET pregnancy=\'Twins\' WHERE case_id=$1',[caseId]))).rejects.toThrow();
  await expect(tx(one,db=>lookupRegistrationPet(db,users.anc,{hn:values[0][1]},deps))).rejects.toThrow('FORBIDDEN');
  await writeFile(path.join(out,'evidence.json'),JSON.stringify({status:'PASS',database:name,roles:['app_rw'],concurrentCases:new Set(pair.map(x=>x.caseId)).size,sequence:numbers,monthBoundaries:months,pdf:{file:'labels.pdf',bytes:pdf!.length,sha256:createHash('sha256').update(pdf!).digest('hex'),readback:text},immutableRegistration:'PASS',unauthorizedHn:'DENIED'},null,2));
 }finally{await one.end().catch(()=>{});await two.end().catch(()=>{});await owner.end().catch(()=>{});await admin.query('DROP DATABASE '+name);await admin.end();await rm(root,{recursive:true,force:true});}
},120000);

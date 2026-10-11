import {it,expect} from 'vitest';
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {migrate} from '../../tools/migrate';
import {assertSyntheticDatabase} from '../../packages/db/connection';
import {hashPassword} from '../../packages/security/password';
import {digest} from '../../packages/security/session';
import {registerP2,getCase,saveRequest,lockRequest,doctorAction,prepareConsent,startSigning,patientAction,reauthenticate,withdraw,type Staff} from '../../packages/p2/service';
import {emptyRequest} from '../../packages/p2/schema';
// Explicitly opt-in; never uses DATABASE_URL/Production. Disposable native DB only.
it.skipIf(!process.env.NIPT_TEST_DATABASE_URL)('native P2 app_rw grants, simultaneous registration/version races and immutable evidence',async()=>{
 const url=process.env.NIPT_TEST_DATABASE_URL!;assertSyntheticDatabase(url);const owner=new Client({connectionString:url});await owner.connect();const app=new Client({connectionString:url}),other=new Client({connectionString:url});
 try{await migrate(owner);await owner.query(await readFile('packages/db/roles.sql','utf8'));const suffix=crypto.randomUUID().slice(0,8),hash=await hashPassword('SYNTHETIC-NATIVE-PASSWORD-48!');
 const unit=(await owner.query("INSERT INTO unit(code,name) VALUES($1,'จำลอง') RETURNING id",['SYNTHETIC_'+suffix])).rows[0].id;
 const users:Staff[]=[];for(const [name,role] of [['anc','ANC_NURSE'],['admin','APP_ADMIN'],['checker','CLINICAL_APPROVER']] as const){const u=(await owner.query("INSERT INTO app_user(username,display_name,password_hash) VALUES($1,'จำลอง',$2) RETURNING id",['synthetic.'+name+'.'+suffix,hash])).rows[0].id;users.push({id:u,roles:[role],unitIds:[unit],permissions:[]});}
 const [anc,admin,checker]=users;await app.connect();await other.connect();await app.query('SET ROLE app_rw');await other.query('SET ROLE app_rw');
 const tx=async<T>(client:Client,fn:()=>Promise<T>)=>{await client.query('BEGIN');try{const r=await fn();await client.query('COMMIT');return r;}catch(e){await client.query('ROLLBACK');throw e;}};
 const numeric=String(Date.now()).slice(-9),ln='00990'+numeric,input={ln,hn:'00990'+numeric,unitId:unit,origin:'ANC',idempotencyKey:'SYNTHETIC_NATIVE_A_'+suffix};
 const a=tx(app,()=>registerP2(app,anc,input,Buffer.alloc(32,8))),b=tx(other,()=>registerP2(other,anc,{...input,idempotencyKey:'SYNTHETIC_NATIVE_B_'+suffix},Buffer.alloc(32,8)));const results=await Promise.all([a,b]);expect(results.filter(r=>r.outcome==='CREATED')).toHaveLength(1);expect(results[0].caseId).toBe(results[1].caseId);const id=results[0].caseId!;
 const proposal=await tx(app,()=>doctorAction(app,admin,{action:'propose',doctorKey:'SYNTHETIC-'+suffix.toUpperCase(),name:'SYNTHETIC native doctor',unitId:unit,effectiveFrom:'2020-01-01T00:00:00Z',authorization:'SYNTHETIC authority',vector:{width:600,height:200,strokes:[[[10,10],[80,90]]]}}));await tx(app,()=>doctorAction(app,checker,{action:'approve',id:proposal.id,reason:'SYNTHETIC checked'}));
 const d=structuredClone(emptyRequest);d.patient.syntheticName='SYNTHETIC native patient';Object.assign(d.pregnancy,{type:'Singleton',edd:'2027-01-01',collectionDate:'2026-08-01',collectionSource:'ANC',weightKg:60,heightCm:160,vanishingTwin:'No',fetalSex:'DoNotWant',sca:'DoNotWant'});for(const k of ['transfusion4months','heparin24h','immune1month','albumin4weeks','exogenousDna4weeks'] as const)d.history[k].answer='No';Object.assign(d.history,{cancerTreatment:'No',gaUnder8:'No',tumor:'No',priorChromosomeTest:'No',otherHistory:'No'});d.ordering.doctorVersionId=String(proposal.id);
 const updates=await Promise.allSettled([tx(app,()=>saveRequest(app,anc,id,{expectedVersion:0,draft:d})),tx(other,()=>saveRequest(other,anc,id,{expectedVersion:0,draft:d}))]);expect(updates.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(updates.find(x=>x.status==='rejected')).toMatchObject({reason:{code:'VERSION_CONFLICT'}});
 const locked=await tx(app,()=>lockRequest(app,anc,id,{expectedVersion:1,reason:'SYNTHETIC locked'}));await expect(app.query("UPDATE p2_document_revision SET reason='tamper' WHERE id=$1",[locked.id])).rejects.toThrow(/permission denied|append-only/);expect((await tx(app,()=>getCase(app,anc,id))).case.hn).toBe(input.hn);
 const session=(await owner.query("INSERT INTO app_session(user_id,token_hash,csrf_hash,idle_expires_at,absolute_expires_at) VALUES($1,$2,$3,now()+interval '30 minutes',now()+interval '8 hours') RETURNING id",[anc.id,digest(crypto.randomUUID()),digest(crypto.randomUUID())])).rows[0].id;anc.sessionId=session;
 const consent=await tx(app,()=>prepareConsent(app,anc,id,{doctorVersionId:proposal.id,representativeRequired:false,reason:'SYNTHETIC prepared'}));const signing=await tx(app,()=>startSigning(app,anc,id,{documentId:consent.id,devicePresent:true,syntheticPatient:true}));const csrf={origin:'http://localhost:3000',expectedOrigin:'http://localhost:3000',token:signing.csrf};for(let item=1;item<=12;item++)await tx(app,()=>patientAction(app,signing.raw,{action:'acknowledge',item},csrf));await tx(app,()=>patientAction(app,signing.raw,{action:'complete',decision:'Granted',vector:{width:600,height:200,strokes:[[[10,10],[80,90]]]}},csrf));
 await expect(app.query('INSERT INTO p2_final_consent(session_id,document_id,payload,content_hash) VALUES($1,$2,$3,$4)',[signing.sessionId,consent.id,{},'a'.repeat(64)])).rejects.toThrow('PREPARER_ATTESTATION_REQUIRED');
 expect(await tx(app,()=>reauthenticate(app,anc,{password:'SYNTHETIC-NATIVE-PASSWORD-48!',attestation:true}))).toEqual({ok:true});
 await expect(app.query('INSERT INTO p2_final_consent(session_id,document_id,payload,content_hash) VALUES($1,$2,$3,$4)',[signing.sessionId,consent.id,{},'a'.repeat(64)])).rejects.toThrow('PREPARER_ATTESTATION_REQUIRED');
 expect((await owner.query("SELECT payload->'signature'->>'decision' decision FROM p2_final_consent WHERE session_id=$1",[signing.sessionId])).rows[0].decision).toBe('Granted');expect(await tx(app,()=>withdraw(app,anc,id,{reason:'SYNTHETIC native revoke'}))).toMatchObject({state:'RevokedHold'});
 expect((await owner.query('SELECT count(*)::int n FROM p2_revocation WHERE case_id=$1',[id])).rows[0].n).toBe(1);
 }finally{await Promise.allSettled([app.end(),other.end(),owner.end()]);}
},120000);

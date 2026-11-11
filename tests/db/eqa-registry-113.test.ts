import {it,expect} from 'vitest';
import {inboundFixture,register,registrar} from '../helpers/inbound';
import {tx,labUsers} from '../helpers/lab';
import {registerEqaCase} from '../../packages/eqa/service';
import {readEqaRegistry,readIqc} from '../../packages/eqa/registry';

const card=(unitId:string,o:Partial<Record<string,unknown>>={})=>({
 ln:'990001013001',unitId,idempotencyKey:'reg-'+Math.random().toString(16).slice(2)+'0000',organizer:'GenQA/EMQN',programYear:2026,
 sampleRef:'9900004001',surname:'POLSON',firstName:'Tonya',dob:'1988-08-23',gaWeeks:11,gaDays:1,collectionDate:'2026-10-19',pregnancy:'Singleton',...o
});

it('EQA registry lists only EQA cases, shows no report before one exists, filters, and refuses non-reviewers',async()=>{
 const f=await inboundFixture();
 try{
  const {unit,lab}=await registrar(f.db);
  const eqa=await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit),f.lookupKey,{store:f.store}));
  await tx(f.db,()=>registerEqaCase(f.db,lab,card(unit,{ln:'990001013002',sampleRef:'9900004002',surname:'ESPOSITO',firstName:'Alessia',pregnancy:'Twins'}),f.lookupKey,{store:f.store}));
  await register(f,{ln:'990001013003',hn:'9900004003',origin:'LAB_DIRECT'});
  const all=await readEqaRegistry(f.db,lab,{});
  expect(all.total).toBe(2);
  expect(all.rows.map(r=>r.sampleRef).sort()).toEqual(['9900004001','9900004002']);
  const one=all.rows.find(r=>r.caseId===eqa.caseId)!;
  expect(one).toMatchObject({organizer:'GenQA/EMQN',programYear:2026,pregnancy:'Singleton',lnHalos:eqa.lnHalos,versionId:null,versions:0,run:null});
  expect((await readEqaRegistry(f.db,lab,{q:'esposito'})).rows.map(r=>r.surname)).toEqual(['ESPOSITO']);
  expect((await readEqaRegistry(f.db,lab,{year:2025})).total).toBe(0);
  // The search form submits empty fields for unused filters; they must mean "no filter".
  expect((await readEqaRegistry(f.db,lab,{q:'polson',year:'',page:'',pageSize:''})).total).toBe(1);
  expect((await readEqaRegistry(f.db,lab,{q:eqa.lnHalos!.toLowerCase()})).total).toBe(1);
  const users=await labUsers(f.db);
  await expect(readEqaRegistry(f.db,users.anc,{})).rejects.toThrow(/FORBIDDEN/);
  await expect(readEqaRegistry(f.db,lab,{pageSize:7})).rejects.toThrow();
 }finally{await f.close();}
});

it('IQC lists the recorded PC (slot 1), NC (slot 25) and Blank (slot 40) concentrations of the latest saved revision with the Task List 1 operator; patients never appear; no thresholds',async()=>{
 const f=await inboundFixture();
 try{
  const {lab}=await registrar(f.db);
  const staff=lab;
  // Batch and its 48 slots inserted directly: creating one through the service needs the owner's task master, which is not the subject here.
  const b={batchId:(await f.db.query<{id:string}>("INSERT INTO lab_batch(run_year,run_number,run_label,template_version,formula_version,created_by) VALUES(2026,1,'Run001/2026','t','f',$1) RETURNING id",[staff.id])).rows[0].id};
  await f.db.query(`INSERT INTO lab_batch_slot(batch_id,slot_number,sheet_number,plate_position,barcode_index,control_type)
   SELECT $1,n,CASE WHEN n<=16 THEN 1 WHEN n<=32 THEN 2 ELSE 3 END,substr('ABCDEFGH',((n-1)%8)+1,1)||(((n-1)/8)+1)::text,n,CASE n WHEN 1 THEN 'positive' WHEN 25 THEN 'negative' WHEN 40 THEN 'blank' END FROM generate_series(1,48) n`,[b.batchId]);
  const values=(rev:number)=>({'slot.1.printedSampleId':'PC-1','slot.25.printedSampleId':'NC-25','slot.40.printedSampleId':'BLANK-40','slot.1.libraryQc':rev===1?5:20,'slot.25.libraryQc':0.5,'slot.40.libraryQc':0.4,'slot.2.libraryQc':33});
  for(const rev of [1,2])await f.db.query(`INSERT INTO task_workbook_revision(batch_id,revision,master_sha256,source_sha256,source_snapshot,values,created_by) VALUES($1,$2,'4c5300f9039af57c0d0649160f5da8e4c2ee1ed7ae44dd7aa525823104f9c7f1',$3,'{}',$4,$5)`,
   [b.batchId,rev,'a'.repeat(64),JSON.stringify(values(rev)),staff.id]);
  // Owner 2026-11-11: the operator of the Run is the one planned on Task List 1.
  await f.db.query("INSERT INTO lab_task_sheet(batch_id,sheet_number,planned_operator) VALUES($1,1,'SJ / SC'),($1,2,'XX'),($1,3,'YY')",[b.batchId]);
  const d=await readIqc(f.db,staff,{});
  expect(d.rows.map(r=>[r.control,r.sampleId,r.concentration])).toEqual([['PC','PC-1',20],['NC','NC-25',0.5],['BLANK','BLANK-40',0.4]]);
  expect(d.rows.map(r=>r.operator)).toEqual(['SJ / SC','SJ / SC','SJ / SC']); // Task List 1 for every row of the Run, not the sheet holding the slot
  expect(d.rows.every(r=>!('slot' in r)&&!('extractionQc' in r)&&!('workbookRevision' in r)&&!('reviewed' in r))).toBe(true);
  expect((await readIqc(f.db,staff,{control:'BLANK'})).rows.map(r=>r.control)).toEqual(['BLANK']);
  // Owner 2026-11-11: filter by one Task List 1 operator; "SJ / SC" is found by SJ and by SC, never by a part of a name or another sheet's operator.
  expect(d.operators.map(o=>o.value)).toEqual(['SC','SJ']);
  expect((await readIqc(f.db,staff,{operator:'SC'})).rows).toHaveLength(3);
  expect((await readIqc(f.db,staff,{operator:'SJ',control:'NC'})).rows.map(r=>r.control)).toEqual(['NC']);
  for(const none of ['S','XX','SJ / SC'])expect((await readIqc(f.db,staff,{operator:none})).total).toBe(0);
  await f.db.query("UPDATE app_user SET display_name='นางสาว สมใจ ใจดี',initial_name='SJ' WHERE id=$1",[staff.id]);
  expect((await readIqc(f.db,staff,{})).operators).toEqual([{value:'SC',label:'SC'},{value:'SJ',label:'SJ — สมใจ'}]);
  expect(JSON.stringify(d)).not.toMatch(/threshold|mean|sd|pass|fail/i);
  expect((await readIqc(f.db,staff,{control:'NC'})).rows.map(r=>r.control)).toEqual(['NC']);
  const users=await labUsers(f.db);
  await expect(readIqc(f.db,users.anc,{})).rejects.toThrow(/FORBIDDEN/);
 }finally{await f.close();}
});

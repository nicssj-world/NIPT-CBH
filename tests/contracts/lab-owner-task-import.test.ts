import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {readArchive,sha256} from '../../packages/workbook/archive';
import {exportOwnerTaskImport,bangkokDnbId,niftyPatientEligible} from '../../packages/sequencing/owner-task-import';
const template=readFileSync('C:/Users/User/Downloads/Task Import template(3).xlsx');
const all=Array.from({length:48},(_,i)=>({slot:i+1,sampleId:i===0?'PC-actual':i===24?'NC-actual':`26B261022${String(i+1).padStart(3,'0')}-1`}));
it.each([[40],[7,40],[13,40],[],[1,25,40]].map(excluded=>({excluded})))('HALOS retains only actual positions, with gaps and exact immutable schema: excluded $excluded',({excluded})=>{
 const before=sha256(template),members=all.filter(r=>!excluded.includes(r.slot)),out=exportOwnerTaskImport(template,members,new Date('2027-10-21T17:00:00Z'));
 const p=readArchive(out.bytes),original=readArchive(template),xml=p.get('xl/worksheets/sheet1.xml')!.toString(),rows=[...xml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)];
 expect(rows).toHaveLength(members.length+1);expect(out.mapping.map(r=>r.physicalSlot)).toEqual(members.map(r=>r.slot));
 for(let i=1;i<rows.length;i++){expect(rows[i][0]).toContain('DNB20271022');expect(rows[i][0]).toMatch(new RegExp(`<c[^>]*r="D${i+1}"[^>]*><v>${members[i-1].slot}</v></c>`));expect(rows[i][0]).toMatch(new RegExp(`<c[^>]*r="E${i+1}"[^>]*/>`));expect(rows[i][0]).toContain('L01');}
 expect(rows[0][0]).toBe([...original.get('xl/worksheets/sheet1.xml')!.toString().matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)][0][0]);
 for(const [name,bytes]of original)if(name!=='xl/worksheets/sheet1.xml')expect(p.get(name)!.equals(bytes)).toBe(true);
 expect(sha256(template)).toBe(before);expect(before).toBe('1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec');
});
it('uses one actual Bangkok click date on either side of midnight; rejects duplicates and altered template',()=>{
 expect(bangkokDnbId(new Date('2027-10-21T16:59:59Z'))).toBe('DNB20271021');expect(bangkokDnbId(new Date('2027-10-21T17:00:00Z'))).toBe('DNB20271022');
 expect(()=>exportOwnerTaskImport(template,[all[0],all[0]],new Date())).toThrow('TASK_IMPORT_DUPLICATE_POSITION');
 expect(()=>exportOwnerTaskImport(Buffer.from('altered'),all,new Date())).toThrow('TASK_IMPORT_TEMPLATE_SHA256_MISMATCH');
});
it('NIFTY includes authorized repeat lineage regardless of earlier specimen sequencing',()=>{
 expect(niftyPatientEligible({attemptNumber:1,repeatOrderId:null,previousSeqOnSameRound:false})).toBe(true);
 expect(niftyPatientEligible({attemptNumber:3,repeatOrderId:null,previousSeqOnSameRound:true})).toBe(false);
 expect(niftyPatientEligible({attemptNumber:6,repeatOrderId:'exceptional-repeat',previousSeqOnSameRound:true})).toBe(true);
 expect(niftyPatientEligible({attemptNumber:2,repeatOrderId:'actual-repeat',previousSeqOnSameRound:false})).toBe(true);
 expect(niftyPatientEligible({attemptNumber:1,repeatOrderId:null,previousSeqOnSameRound:true})).toBe(true);
});

it('HALOS refuses repeated analytical text within a single vendor mapping and preserves internal provenance outside vendor columns',()=>{
 expect(()=>exportOwnerTaskImport(template,[{slot:2,sampleId:'26B261023001R-1'},{slot:3,sampleId:'26B261023001R-1'}],new Date())).toThrow('TASK_IMPORT_DUPLICATE_SAMPLE_ID');
 const out=exportOwnerTaskImport(template,[{slot:2,sampleId:'26B261023001R-1',attemptId:'unique-attempt-5',roundId:'S2',caseId:'case-1',overallOrdinal:5}],new Date('2026-10-23T08:00:00Z'));
 expect(out.mapping[0]).toMatchObject({sampleId:'26B261023001R-1',attemptId:'unique-attempt-5',roundId:'S2',caseId:'case-1',overallOrdinal:5,physicalSlot:2});
 const xml=readArchive(out.bytes).get('xl/worksheets/sheet1.xml')!.toString();expect(xml).toContain('26B261023001R-1');expect(xml).not.toContain('unique-attempt-5');
});

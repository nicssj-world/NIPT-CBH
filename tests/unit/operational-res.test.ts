import {it,expect} from 'vitest';
import {serializeOperationalRes,syntheticProfile,serializeSyntheticRes} from '../../packages/p6/res';
import {verifyRes} from '../../packages/integrations/res';
it('serializes reviewed operational identifiers in the existing UTF16LE RES contract without inventing an ACK',()=>{
 const input={order:{ln:'2628270019',hn:'0001234',dspname:'นาง ทดสอบ ระบบ',dob:'19900101',sex:'F' as const,specimen_date:'20261014070000'},generatedAt:'20261014100000',approvedAt:'20261014093000',certifierHisId:'TESTMT^ผู้ทดสอบ',result:null};
 const profile={...syntheticProfile,syntheticOnly:false as const,version:'TEST-OPERATIONAL-1',wardName:'หน่วยทดสอบ'};
 const result=serializeOperationalRes(input,profile),rows=verifyRes(result.bytes);
 expect(rows[1][2]).toBe(input.order.ln);expect(rows[1][3]).toBe(input.order.hn);expect(rows[3][10]).toBe(input.certifierHisId);
 expect(rows.map(r=>r.length)).toEqual([14,35,26,12,3]);
 expect(verifyRes(serializeOperationalRes({...input,order:{...input.order,hn:'00007701/69'}},profile).bytes)[1][3]).toBe('00007701/69');
 for(const hn of ['bad|id','bad^id','bad\nid','../bad'])expect(()=>serializeOperationalRes({...input,order:{...input.order,hn}},profile)).toThrow();
 expect(()=>serializeSyntheticRes(input as never)).toThrow();
 expect(()=>serializeOperationalRes({...input,certifierHisId:'TEST|INJECTION'},profile)).toThrow();
 expect(()=>serializeOperationalRes(input,syntheticProfile)).toThrow();
});

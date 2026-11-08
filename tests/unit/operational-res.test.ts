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

const base=()=>({input:{order:{ln:'2630170072',hn:'1137296',dspname:'น.ส. พรรณวจี  แก้วจันทร์',dob:'20060912',sex:'F' as const,specimen_date:'20261028101716'},generatedAt:'20261105113916',approvedAt:'20261105113916',certifierHisId:'11351^9495',result:null},
 profile:{...syntheticProfile,syntheticOnly:false as const,version:'HIS-1',receiver:'host',wardName:'ฝากครรภ์',style:'fixed' as const}});
it('keeps the legacy bytes when no editable RES override is configured',()=>{
 const {input,profile}=base();
 const rows=verifyRes(serializeOperationalRes(input,profile).bytes);
 expect(rows[0][11]).toBe('P');expect(rows[1][7]).toBe('20060912');expect(rows[1][24]).toBe('R');expect(rows[1][27]).toBe('^O');expect(rows[1][34]).toBe('^99');expect(rows[2][25]).toBe('F');expect(rows[3][8]).toBe('F');
});
it('writes the HIS-style date of birth and every configurable constant at its HL7 position',()=>{
 const {input,profile}=base();
 const rows=verifyRes(serializeOperationalRes(input,{...profile,dobFormat:'YYYY-MM-DD',processingId:'T',patientClass:'I',p27:'^X',p34:'^98',orderStatus:'C',resultStatus:'P'}).bytes);
 expect(rows[1][7]).toBe('2006-09-12');expect(rows[0][11]).toBe('T');expect(rows[1][24]).toBe('I');expect(rows[1][27]).toBe('^X');expect(rows[1][34]).toBe('^98');expect(rows[2][25]).toBe('C');expect(rows[3][8]).toBe('P');
});
it('rejects structural characters in the configurable constants',()=>{
 const {input,profile}=base();
 for(const patch of [{processingId:'a|b'},{patientClass:'a\b'},{p27:'a~b'},{p34:'a&b'},{orderStatus:'a\nb'},{resultStatus:'a\rb'},{dobFormat:'DD/MM/YYYY'}])expect(()=>serializeOperationalRes(input,{...profile,...patch} as never)).toThrow();
});

it('reproduces the structure of the HIS example .res (2630170072119.res) line by line with fictional identifiers',()=>{
 const {input}=base();
 const hisProfile={...syntheticProfile,syntheticOnly:false as const,version:'HIS-RES-1',receiver:'host',wardName:'ฝากครรภ์',style:'fixed' as const,dobFormat:'YYYY-MM-DD' as const,processingId:'P',patientClass:'R',p27:'^O',p34:'^99',orderStatus:'F',resultStatus:'F'};
 const ln='2699000001',hn='1000001',ts='20261105113916',spec='20261028101716',cfs='ดูรายงานผลในโปรแกรม CFS';
 const res=serializeOperationalRes({...input,order:{...input.order,ln,hn,dspname:'น.ส. ตัวอย่าง  ทดสอบ',dob:'20060912',specimen_date:spec},generatedAt:ts,approvedAt:ts},hisProfile);
 const lines=res.bytes.subarray(2).toString('utf16le').split('\r');
 expect(res.bytes.subarray(0,2)).toEqual(Buffer.from([255,254]));
 expect(res.filename).toBe('2699000001119.res');
 expect(res.ok).toEqual(Buffer.from([255,254]));
 expect(lines.slice(0,5)).toEqual([
  `H|\\^&|||CIT5K|||||host||P||${ts}`,
  `P|1|${ln}|${hn}|^|ทดสอบ^^น.ส. ตัวอย่าง||2006-09-12|F|||||||||||||${ln}||${spec}^${spec}|R|301^ฝากครรภ์||^O||||||0^301|^99`,
  `O|1|${ln}||^^^70096^B^0|||||||||||2|||7|||||||F`,
  `R|1|^^^70096^B^0|${cfs}|||A||F|${ts}^${ts}|11351^9495|${ln}118`,
  'L|1|N']);
});

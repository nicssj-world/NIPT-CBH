import {expect,it} from 'vitest';
import {qcSourceHash} from '../../packages/lab/bench';
import {digest} from '../../packages/pooling/calculation';

it('pooling amount changes the export source, while QC2 and operator metadata do not',()=>{
 const qc={'slot.1.libraryQc':20,'qc.1.standard1':10};
 const original=qcSourceHash([],qc);
 expect(original).toBe(digest({slots:[],values:{'qc.1.standard1':10,'slot.1.libraryQc':20}}));
 expect(qcSourceHash([],{...qc,'pool.amount':16})).toBe(original);
 expect(qcSourceHash([],{...qc,'pool.amount':12})).not.toBe(original);
 expect(qcSourceHash([],{...qc,'pool.concentration':3.4,'pool.operator':'SYNTHETIC'})).toBe(original);
 expect(qcSourceHash([],{...qc,'slot.1.libraryQc':21})).not.toBe(original);
});

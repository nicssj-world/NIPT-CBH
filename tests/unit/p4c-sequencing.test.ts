import {describe,it,expect} from 'vitest';
import {qubitCalculation,stability,verificationErrors} from '../../packages/sequencing/service';
import {createSchema,sequencingSchema,fixtureMember} from '../../packages/sequencing/schemas';
import {randomUUID} from 'node:crypto';
import {dnbInput} from '../helpers/sequencing';
const member={memberKey:'synthetic-member',physicalPosition:2,role:'PATIENT' as 'PATIENT'|'PC'|'NC',exportSampleId:'SYN-EXPORT',printedSampleId:'SYN-PRINT',lnHalos:'SYN-LN',barcodeIndex:2,barcodeType:'SYN-BC'};
describe('restricted synthetic DNB formulas and exact transfer comparison',()=>{
 it('FS10 includes two standards and surfaces contradictory table without promoting acceptance',()=>{expect(qubitCalculation(3)).toMatchObject({bufferUl:995,dyeUl:5,totalUl:1000,approved:false});expect(qubitCalculation(1)).toMatchObject({bufferUl:597,dyeUl:3});for(const n of [0,-1,49,1.5,NaN,'3'])expect(()=>qubitCalculation(n)).toThrow();});
 it('stability is informational at proposed 4C/48h including expired/unknown/negative time',()=>{const now=new Date('2026-10-13T00:00Z');expect(stability('2026-10-11T00:00Z',now)).toMatchObject({status:'WITHIN_PROPOSED_WINDOW',clinicalAccepted:false});expect(stability('2026-10-10T23:59Z',now).status).toBe('OUTSIDE_PROPOSED_WINDOW');expect(stability(null,now).status).toBe('PRODUCT_TIME_UNAVAILABLE');expect(stability('2026-10-14T00:00Z',now).status).toBe('INVALID_TIME');});
 it('compares count, ordering, printed ID, LN, export ID, barcode, control, status and file hashes',()=>{
  const compare=(rows:typeof member[],status='Complete',dnb='DNB20261013',hash='a')=>verificationErrors([member],rows,status,'DNB20261013',dnb,'a',hash);
  expect(compare([member])).toEqual([]);expect(compare([])).toContain('MISSING_MEMBER');expect(compare([member,member])).toContain('DUPLICATE_memberKey');
  expect(compare([{...member,memberKey:'extra'}])).toContain('EXTRA_MEMBER');
  for(const key of ['printedSampleId','lnHalos','exportSampleId','barcodeType'])expect(compare([{...member,[key]:'wrong'}])).toContain('ORDER_OR_IDENTITY_OR_BARCODE_MISMATCH');
  expect(compare([{...member,barcodeIndex:13}])).toContain('ORDER_OR_IDENTITY_OR_BARCODE_MISMATCH');expect(compare([member],'Incomplete')).toContain('TRANSFER_NOT_COMPLETE');expect(compare([member],'Complete','wrong')).toContain('DNB_ID_MISMATCH');expect(compare([member],'Complete','DNB20261013','b')).toContain('FILE_HASH_MISMATCH');
  expect(compare([fixtureMember.parse({...member,printedSampleId:' '+member.printedSampleId})])).toContain('ORDER_OR_IDENTITY_OR_BARCODE_MISMATCH');
 });
 it('strict schemas reject unknown clinical choices, credentials and guessed DNB preparation method',()=>{
  const input=dnbInput(randomUUID(),randomUUID(),0,randomUUID());expect(createSchema.parse(input).preparation.method).toBe('UNRESOLVED_OD32_WC05');
  expect(()=>createSchema.parse({...input,password:'forbidden'})).toThrow();expect(()=>createSchema.parse({...input,actualDate:'2026-02-30'})).toThrow();expect(()=>createSchema.parse({...input,preparation:{...input.preparation,method:'PCR'}})).toThrow();
  expect(()=>sequencingSchema.parse({equipmentModel:'G50',password:'forbidden'})).toThrow();
 });
});

import {afterEach,describe,expect,it,vi} from 'vitest';
import iconv from 'iconv-lite';
import {parsePet,PARSER_VERSION} from '../../packages/integrations/pet';
import {buildSyntheticPet} from '../../packages/inbound/wire';
import {operationalTestPetBytes} from '../../tools/operational/test-pet-fixture';

afterEach(()=>vi.unstubAllEnvs());
describe('LAB-11 Owner-locked PET clock semantics',()=>{
 it('Home UAT S2 changes the true receipt while retaining order and collection',()=>{
  vi.stubEnv('NIPT_MODE','operational');vi.stubEnv('APP_ORIGIN','https://127.0.0.1:19548');
  const input={ln:'9903001000',hn:'9900041000',day:'20261022'};
  const first=parsePet(operationalTestPetBytes(input),input.ln+'-7.pet');
  const second=parsePet(operationalTestPetBytes({...input,time:'120000'}),input.ln+'-7.pet');
  expect(first).toMatchObject({orderAt:'2026-10-22T07:00:00+07:00',specimenAt:'2026-10-22T07:00:00+07:00',receivedAt:'2026-10-22T10:00:00+07:00'});
  expect(second).toMatchObject({orderAt:first.orderAt,specimenAt:first.specimenAt,receivedAt:'2026-10-22T12:00:00+07:00'});
 });
 it('maps P21 order and both P23 components, independently of O14 and chronological sorting',()=>{
  const fixture=buildSyntheticPet({ln:'990001234567',hn:'990001001',orderAt:'20261021100506',specimenAt:'20261021110708',receivedAt:'20261021120910'});
  const lines=iconv.decode(fixture.bytes,'windows-874').split('\r\n');
  const p=lines[1].split('|'),o=lines[2].split('|');
  p[21]='20261021100506';o[14]='20261020010203';lines[1]=p.join('|');lines[2]=o.join('|');
  const parsed=parsePet(iconv.encode(lines.join('\r\n'),'windows-874'),fixture.filename);
  expect(parsed).toMatchObject({orderAt:'2026-10-21T10:05:06+07:00',specimenAt:'2026-10-21T11:07:08+07:00',receivedAt:'2026-10-21T12:09:10+07:00'});
  expect(PARSER_VERSION).toBe('pet-strict-cp874-owner-clock-v2');
 });
 it('fixture builder exercises the same operational field mapping',()=>{
  const f=buildSyntheticPet({ln:'990001234567',hn:'990001001',orderAt:'20261021100506',specimenAt:'20261021110708',receivedAt:'20261021120910'});
  const p=iconv.decode(f.bytes,'windows-874').split('\r\n')[1].split('|');
  expect(p[21]).toBe('20261021100506');
  expect(p[23]).toBe('20261021110708^20261021120910');
 });
 it('rejects missing receipt rather than using order or file discovery time',()=>{
  const f=buildSyntheticPet({ln:'990001234567',hn:'990001001',receivedAt:'20261021120910'});
  const lines=iconv.decode(f.bytes,'windows-874').split('\r\n'),p=lines[1].split('|');p[23]=p[23].split('^')[0];lines[1]=p.join('|');
  expect(()=>parsePet(iconv.encode(lines.join('\r\n'),'windows-874'),f.filename)).toThrow('INVALID_PET_COLLECTION_RECEIPT');
 });
});

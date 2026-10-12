import {describe,it,expect} from 'vitest';
import {randomBytes} from 'node:crypto';
import iconv from 'iconv-lite';
import {parsePet,syntheticPet} from '../../packages/integrations/pet';
import {buildSyntheticPet,classifyPet,sectionOf,redactPet,petDifferences} from '../../packages/inbound/wire';
import {compareRegistrant,lnHnKey} from '../../packages/inbound/identity';
import {lookbackFolders} from '../../packages/inbound/discovery';
import {backoffSeconds,MAX_BACKOFF_SECONDS} from '../../packages/inbound/cycle';
import {summarizeInboundHealth} from '../../packages/inbound/health';
import {maskLn} from '../../packages/inbound/queue';

const key=randomBytes(32),spec={ln:'0099000100001',hn:'9900001001',receivedAt:'20261012090000'};
describe('P3 wire helpers',()=>{
 it('builder emits the legacy field widths H=13/P=35/O=29/L=3 and round-trips through the P1 parser with leading zeros',()=>{
  const f=buildSyntheticPet(spec),lines=iconv.decode(f.bytes,'windows-874').split('\r\n').filter(Boolean).map(x=>x.split('|'));
  expect(lines.map(x=>x.length)).toEqual([13,35,29,3]);
  const p=parsePet(f.bytes,f.filename);expect(p.ln).toBe('0099000100001');expect(f.filename).toBe('0099000100001-7.pet');expect(p.hn).toBe('9900001001');
 });
 it('P1 synthetic guard still rejects non-synthetic HN/LN ranges and keeps P1 fixtures valid',()=>{
  expect(()=>parsePet(buildSyntheticPet({...spec,hn:'12345678'}).bytes,'0099000100001-7.pet')).toThrow('SYNTHETIC_ONLY');
  const real=buildSyntheticPet({...spec,ln:'2622270001'});expect(()=>parsePet(real.bytes,real.filename)).toThrow('SYNTHETIC_ONLY');
  for(let i=0;i<5;i++){const s=syntheticPet(i);expect(parsePet(s.bytes,s.filename).hn).toBe('SYNTHETIC-HN-'+i);}
 });
 it('classifies section, test code, encoding and structure without dropping malformed NIPT files',()=>{
  expect(sectionOf('99000123456-60.pet')).toEqual({ln:'99000123456',section:'60'});expect(sectionOf('x-7.pet')).toBeNull();expect(sectionOf('990001-7.ok')).toBeNull();
  expect(classifyPet(buildSyntheticPet(spec).bytes)).toBe('NIPT');
  expect(classifyPet(buildSyntheticPet({...spec,testCode:'11111'}).bytes)).toBe('NOT_NIPT');
  expect(classifyPet(Buffer.concat([buildSyntheticPet(spec).bytes,Buffer.from([0xdb])]))).toBe('INVALID_ENCODING');
  expect(classifyPet(iconv.encode('H|x\r\nL|1|N','windows-874'))).toBe('MALFORMED');
 });
 it('redaction keeps only HMAC + last four of P[33]; differences report field names only',()=>{
  const p=parsePet(buildSyntheticPet({...spec,identity:'SYNTHETIC-ID-7788'}).bytes,'0099000100001-7.pet'),r=redactPet(p,key);
  expect(r).not.toHaveProperty('identity');expect(r.identityLastFour).toBe('7788');expect(r.identityKey).toMatch(/^[a-f0-9]{64}$/);
  const q=parsePet(buildSyntheticPet({...spec,identity:'SYNTHETIC-ID-7788',name:'SYNTHETIC^^นาง ใหม่',ward:'SYNTHETIC-W2'}).bytes,'0099000100001-7.pet');
  expect(petDifferences(p,q)).toEqual({identity:['name'],order:['ward']});
 });
 it('registrant comparison: LN alone never matches; HN exact; HMAC scheme equals the P2 derivation; NONE is unverified',()=>{
  const p=parsePet(buildSyntheticPet({...spec,dob:'19950505'}).bytes,'0099000100001-7.pet');
  expect(compareRegistrant({scheme:'HN_PLAIN',hn:' 9900001001 '},p,key)).toEqual({outcome:'MATCH'});
  expect(compareRegistrant({scheme:'HN_PLAIN',hn:'009900001001'},p,key)).toEqual({outcome:'MISMATCH',fields:['hn']});
  expect(compareRegistrant({scheme:'HN_PLAIN',hn:'9900001001',dob:'1995-05-06'},p,key)).toEqual({outcome:'MISMATCH',fields:['dob']});
  expect(compareRegistrant({scheme:'HN_PLAIN',hn:''},p,key)).toEqual({outcome:'UNVERIFIED'});
  expect(compareRegistrant({scheme:'LN_HN_HMAC',key:lnHnKey(p.ln,'9900001001',key)},p,key)).toEqual({outcome:'MATCH'});
  expect(compareRegistrant({scheme:'LN_HN_HMAC',key:lnHnKey(p.ln,'9900001002',key)},p,key)).toEqual({outcome:'MISMATCH',fields:['hn']});
  expect(compareRegistrant({scheme:'NONE'},p,key)).toEqual({outcome:'UNVERIFIED'});
 });
 it('Bangkok day folders, bounded exponential backoff, masked LN',()=>{
  expect(lookbackFolders(2,new Date('2026-10-12T17:30:00Z'))).toEqual(['20261012','20261013']);
  expect(lookbackFolders(1,new Date('2026-10-12T16:59:59Z'))).toEqual(['20261012']);
  expect(()=>lookbackFolders(91,new Date())).toThrow('INVALID_LOOKBACK');
  expect([0,1,2,3,10].map(n=>backoffSeconds(n,30))).toEqual([0,30,60,120,MAX_BACKOFF_SECONDS]);
  expect(maskLn('990001000001')).toBe('••••0001');
 });
 it('health keeps Enabled/Alive/Last Success/Last Error separate and never reports a disabled integration healthy',()=>{
  const now=new Date('2026-10-12T05:00:00Z'),base={enabled:true,intervalSeconds:30,lastRun:{outcome:'SUCCESS',finishedAt:new Date(now.getTime()-10_000),errorCode:null},lastSuccessAt:now,consecutiveFailures:0,readyBacklog:0,oldestReadyAt:null,waitingOkOverdue:0,openIssues:{},parseErrors24h:0};
  expect(summarizeInboundHealth(base,now)).toMatchObject({Enabled:true,Alive:true,healthy:true,alerts:[]});
  expect(summarizeInboundHealth({...base,enabled:false},now).healthy).toBe(false);
  expect(summarizeInboundHealth({...base,lastRun:{...base.lastRun,finishedAt:new Date(now.getTime()-600_000)}},now)).toMatchObject({Alive:false,alerts:['INBOUND_NOT_ALIVE']});
  expect(summarizeInboundHealth({...base,waitingOkOverdue:2,parseErrors24h:1},now).alerts).toEqual(['OK_SENTINEL_OVERDUE','PET_PARSE_ERRORS']);
  expect(summarizeInboundHealth({...base,lastRun:{outcome:'PARTIAL',finishedAt:now,errorCode:'S1_NOT_EXPECTED'}},now)).toMatchObject({LastError:'S1_NOT_EXPECTED',healthy:false});
 });
});

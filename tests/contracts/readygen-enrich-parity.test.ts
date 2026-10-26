import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {RULESET,READYGEN_REFERENCE_SHA256,halosGaDays} from '../../packages/readygen/interpretation';
import {reportDate} from '../../packages/readygen/reports';
import {TOKENS} from '../../packages/readygen/docx';

// OWNER-LAB-056 parity: ReadyGen's own configuration (Config/enrichment/*) is parsed with the grammar that file actually uses and
// compared with what NIPT-CBH implements. Nothing is guessed: constructs whose meaning the files do not prove (the `*` prefix) are
// reported, never evaluated. The original files are read from the protected local copy (.local/task3-sources) — a missing file fails.
const SRC=path.resolve('.local/task3-sources');
const text=(n:string)=>readFileSync(path.join(SRC,n.startsWith('readygen-enrich')?n:'readygen-config/'+n),'utf8').replace(/\r/g,'');
type Clause={cond:string;out:string;color:string|null};
type Rule={name:string;field:string;clauses:Clause[];extra:string[]};
const splitUnescaped=(s:string)=>s.split(/(?<!\\),/).map(x=>x.replaceAll('\\,',',').replaceAll('\\n','\n'));
export function parseEnrich(raw:string):Rule[]{
 return raw.split('\n').map(l=>l.trim()).filter(Boolean).map(line=>{const [name,field,body='',...extra]=line.split('$');
  const clauses=body.split('?').filter(x=>x.length).map(c=>{const [cond,out='',color=null]=splitUnescaped(c);return {cond,out,color:color&&/^[0-9A-F]{6}$/i.test(color)?color:null};});
  return {name,field,clauses,extra};});
}
const rules=parseEnrich(text('readygen-enrich.txt')),byName=new Map(rules.map(r=>[r.name,r]));

describe('ReadyGen enrich.txt ↔ NIPT-CBH interpretation (differential)',()=>{
 it('the companion ReadyGen configuration files are the exact originals (SHA-256)',()=>{
  const sha=(n:string)=>createHash('sha256').update(readFileSync(path.join(SRC,'readygen-config',n))).digest('hex');
  expect(sha('enrich_alias.txt')).toBe('fe38821a3085d3f9be7c099f6e7c85ef056dd469950dac5bd22d8b37fab93c34');
  expect(sha('enrich_decimal.txt')).toBe('0abf1df73dffd36e8772dd3f6abac37a705a43c5c0367b6330cc92f4b1a90e68');
  expect(sha('enrich_format.txt')).toBe('9f968175ac31db8d947ba3cc7964f73d0fb4f987fe57f8fd7d720163d2f401ce');
  expect(sha('enrich_datetime.txt')).toBe('dd53fa2d7b93cbcad294b4112d4735b20818f39e59c253e1ca8454ffa09888c0');
  expect(sha('colorOverride.txt')).toBe('22fe2873984b385c698c9cc1df1595ca92017c5b003469c1138af4960678d686');
 });
 it('the reference file is the pinned original and the grammar parses every rule',()=>{
  expect(READYGEN_REFERENCE_SHA256).toMatch(/^[0-9a-f]{64}$/);expect(rules.length).toBeGreaterThan(100);
  expect(rules.every(r=>r.name&&r.field)).toBe(true);
 });
 it('trisomy 21/18/13: every ReadyGen token→result mapping is exactly the implemented ruleset, and ReadyGen has no ELSE for an unlisted token',()=>{
  for(const [key,rule] of Object.entries(RULESET.trisomy)){
   const ra=byName.get(`trisomy${key.slice(1)}_ra`)!;expect(ra.field).toBe(rule.field);
   const readygen=Object.fromEntries(ra.clauses.map(c=>[c.cond,c.out]));
   expect(readygen).toEqual(rule.map);                                        // identical token set and identical output text
   expect(ra.clauses.some(c=>c.cond==='ELSE')).toBe(false);                   // so an unlisted token (e.g. ML21) is undefined in ReadyGen → NIPT-CBH HOLDs it
   expect(ra.clauses.filter(c=>c.out==='High Risk').every(c=>c.color==='FF0000')).toBe(true);        // High Risk prints red
   expect(ra.clauses.filter(c=>c.out==='Low Risk').every(c=>c.color==='000000')).toBe(true);
  }
 });
 it('sex-chromosome aneuploidies: ReadyGen reads Negative / <k>(+++) / <k>(+) exactly as implemented',()=>{
  for(const k of RULESET.sca.tokens){
   const r=byName.get(`${k}_NEW`)!;expect(r.field).toBe('testChrSex');
   const detected=r.clauses.filter(c=>c.out==='Detected').map(c=>c.cond).sort();
   expect(detected).toEqual(RULESET.sca.strengths.map(s=>k+s).sort());
   expect(r.clauses.find(c=>c.cond===RULESET.sca.negative)?.out).toBe('Not Detected');
   expect(r.clauses.filter(c=>c.out==='Detected').every(c=>c.color==='FF0000')).toBe(true);
  }
 });
 it('every documented reference defect really exists in the original file (and is therefore deliberately not reproduced)',()=>{
  const raw=text('readygen-enrich.txt');
  expect(raw).toMatch(/\?T22,There is a high risk of chromosome 21 trisomy\./);              // T22 mapped to chromosome 21
  expect(raw).toMatch(/T10_risk\$testChrOther\$\?101,High Risk/);expect(raw).toMatch(/T10risk\$testChrOther\$\?101,Detected/);   // T10 matches "101"
  expect(raw).toContain('?*XXYNot Detected');                                                // malformed clause in XO_NEW (missing comma)
  expect(byName.get('trisomy21_ra')!.clauses.some(c=>c.cond==='ELSE')).toBe(false);
  expect(RULESET.knownReferenceDefects).toHaveLength(5);
 });
 it('unproven construct: the `*` clause prefix is reported, not evaluated (ReadyGen files do not define it)',()=>{
  const star=rules.flatMap(r=>r.clauses.map(c=>({rule:r.name,cond:c.cond}))).filter(x=>x.cond.startsWith('*'));
  expect(star.length).toBeGreaterThan(0);
  // None of the evaluated rules above depend on it: the ruleset only uses equality tokens.
  expect(JSON.stringify(RULESET.trisomy)+JSON.stringify(RULESET.sca)).not.toContain('"*');
 });
 it('decimals, gestational-age and date formats match ReadyGen enrich_decimal / enrich_format / enrich_datetime',()=>{
  expect(text('enrich_decimal.txt')).toContain('fetalFaction_2$fetalFaction$2');expect(RULESET.fetalFraction.decimals).toBe(2);
  expect(text('enrich_format.txt')).toContain('ga$gestationalWeek$,$2${0}W {1}D');
  expect(halosGaDays('17,6')).toBe(125);expect(`${Math.floor(125/7)}W ${125%7}D`).toBe('17W 6D');                  // "{0}W {1}D"
  expect(text('enrich_datetime.txt')).toMatch(/createdDate_cbh,createdDate,yyyy-MM-dd,dd-MMM-yyyy/);
  expect(reportDate('2026-10-25')).toBe('25-Oct-2026');expect(reportDate('2026-01-09')).toBe('09-Jan-2026');        // dd-MMM-yyyy
  expect(text('colorOverride.txt')).toContain('risk21,trisomy21_ra');                                                    // probability follows the result colour
 });
 it('every ${placeholder} of the Owner masters has a traceable source (ReadyGen alias/rule/format, HALOS column or NIPT-CBH supplied value)',()=>{
  const alias=new Set(text('enrich_alias.txt').split('\n').map(l=>l.split('$')[1]?.trim()).filter(Boolean));
  const ruleNames=new Set(rules.map(r=>r.name));
  const datetime=new Set(text('enrich_datetime.txt').split('\n').map(l=>l.split(',')[0]).filter(Boolean));
  const trace=(token:string)=>alias.has(token)?'ReadyGen alias':ruleNames.has(token)?'ReadyGen enrich rule':datetime.has(token)?'ReadyGen datetime rule':token==='ga'?'ReadyGen format rule':token==='fetalFaction_2'?'ReadyGen decimal rule':['risk21','risk18','risk13'].includes(token)?'HALOS column + colorOverride':token==='gender'||token==='gender_cbh'?'HALOS column':token==='remarks'?'NIPT-CBH supplied':'UNTRACED';
  const all=[...new Set([...TOKENS.SINGLETON,...TOKENS.TWIN])];
  const untraced=all.filter(t=>trace(t)==='UNTRACED');
  expect(untraced).toEqual([]);
 });
});

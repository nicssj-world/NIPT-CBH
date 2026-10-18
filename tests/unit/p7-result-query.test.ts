import {describe,it,expect} from 'vitest';
import {parseResultQuery,resultQuerySql,csvCell,resultCsv,riskOf,publicResultQuery} from '../../packages/results/query';
import {parseReport} from '../../packages/results/parser';

describe('P7 bounded result query and safe CSV',()=>{
 it('validates dates, bounds, state and risk without accepting SQL fragments',()=>{
  expect(parseResultQuery({})).toMatchObject({page:1,pageSize:50,risk:'ALL',bucket:'all'});
  for(const q of [{from:'2026-02-30'},{from:'2026-10-12',to:'2026-10-01'},{pageSize:'301'},{risk:"LOW' OR TRUE"},{bucket:'secret'},{page:'-1'}])expect(()=>parseResultQuery(q)).toThrow();
 });
 it('filters before stable bounded pagination and uses Bangkok import dates',()=>{
  const q=parseResultQuery({from:'2026-10-10',to:'2026-10-11',risk:'UNKNOWN',bucket:'closed',page:'2',pageSize:'10'}),sql=resultQuerySql(q);
  expect(sql.text.indexOf('WHERE')).toBeLessThan(sql.text.indexOf('ORDER BY'));
  expect(sql.text).toContain("AT TIME ZONE 'Asia/Bangkok'");expect(sql.text).toContain('v.id DESC');
  expect(sql.values).toContain('UNKNOWN');expect(sql.values).toContain(11);expect(sql.values.at(-1)).toBe(10);
 });
 it('never calls unrecognized/incomplete values low risk',()=>{
  expect(riskOf(parseReport('unrecognized'))).toBe('UNKNOWN');
 });
 it('adds exact parsed gender/QC, reported-date and literal private search before pagination',()=>{
  const q=parseResultQuery({dateField:'REPORTED',from:'2026-10-01',to:'2026-10-31',q:'001_% จำลอง',gender:'Female',qc:'PASS'}),sql=resultQuerySql(q);
  expect(sql.values).toContain('001_% จำลอง');expect(sql.text).toContain('strpos');expect(sql.text).toContain('reportedDate');expect(sql.text).not.toContain('001_%');expect(sql.text).toContain('make_date');
  for(const input of [{gender:'normal'},{qc:'good'},{dateField:'COLLECTED'},{q:'x'.repeat(101)}])expect(()=>parseResultQuery(input)).toThrow();
  expect(()=>publicResultQuery(new URLSearchParams({q:'001'}))).toThrow('PRIVATE_QUERY_REQUIRES_POST');
  expect(()=>publicResultQuery(new URLSearchParams({q:''}))).toThrow('PRIVATE_QUERY_REQUIRES_POST');
 });
 it('preserves Thai, quotes and zero-prefixed IDs without creating spreadsheet formulas',()=>{
  for(const s of ['=1+1','  @SUM(A1)','\t-3','+42','000123'])expect(csvCell(s)).toContain("'");
  expect(csvCell('จำลอง "ทดสอบ"')).toBe('"จำลอง ""ทดสอบ"""');
  const csv=resultCsv([{id:'id',state:'Unlinked',risk:'UNKNOWN',hn:'000123',lab:'001',original_name:'=1+1',member_name:null,relative_path:null,imported_at:new Date('2026-10-10'),template_kind:'UNKNOWN',ln:null,round_number:null,collection:null}]);
  expect(csv).toContain("'000123");expect(csv).toContain("'=1+1");expect(csv).toContain('UNKNOWN');expect(csv.startsWith('\uFEFF')).toBe(true);
 });
});

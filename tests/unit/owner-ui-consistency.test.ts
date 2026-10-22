import {describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Status} from '../../src/components/p2/shared';
import {historyAnswers} from '../../src/components/p2/request-history-contract';
import {readFileSync} from 'node:fs';
import path from 'node:path';

describe('Owner ANC UI parity',()=>{
 it('renders expected specimen reception as a Thai, semantic status instead of a raw machine code',()=>{
  const html=renderToStaticMarkup(createElement(Status,{value:'Expected',operational:true}));
  expect(html).toContain('รอรับสิ่งส่งตรวจ');
  expect(html).toContain('status-pill');
  expect(html).not.toContain('>Expected<');
 });
 it('keeps the single source of truth for all five DCC history questions',()=>{
  const form=readFileSync(path.resolve('src/components/p2/request-form.tsx'),'utf8');
  expect(historyAnswers).toHaveLength(5);
  expect(form).toContain('historyAnswers.slice(0,4)');
  expect(form).toContain('historyAnswers[4][1]');
  expect(form).not.toContain('const dccHistoryAnswers');
 });
 it('omits the SCA preference removed by the latest Owner Request-template decision',()=>{
  const form=readFileSync(path.resolve('src/components/p2/request-form.tsx'),'utf8');
  expect(form).not.toContain('select("pregnancy.sca"');
  expect(form).not.toContain('data-field="pregnancy.sca"');
  expect(form).not.toContain('["Unspecified","ยังไม่ระบุ"]');
 });
 it('keeps the request controls grouped while retaining GPA and calculated BMI evidence',()=>{
  const form=readFileSync(path.resolve('src/components/p2/request-form.tsx'),'utf8');
  expect(form).toContain('request-patient-grid');
  expect(form).toContain('request-pregnancy-grid');
  expect(form).toContain('request-bmi-cell');
  expect(form).toContain('data-testid="bmi"');
  for(const f of ['pregnancy.gravida','pregnancy.para','pregnancy.abortion'])expect(form).toContain('input("'+f+'"');
 });
});

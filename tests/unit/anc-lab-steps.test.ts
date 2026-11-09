import {describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LAB_STEP_NAMES,queueProgress,registryProgress} from '../../src/components/p2/anc-progress';
import {ProgressView} from '../../src/components/p2/anc-progress-view';

// ANC progress bar (Owner 2026-11-09): the "ตรวจวิเคราะห์" segment moves through the four Lab Run steps; the label stays in people language.
const queue=(labSteps:number|null)=>queueProgress({stage:'analysis',flags:[],hasResult:false,roundState:'ReceivedInNIPT',labSteps});
const html=(p:ReturnType<typeof queue>)=>renderToStaticMarkup(createElement(ProgressView,{progress:p}));
describe('analysis progress inside the ANC bar',()=>{
 it('the four steps are Task List, QC, Pooling, Sequencing',()=>{expect([...LAB_STEP_NAMES]).toEqual(['ลง Task List','ตรวจ QC','Pooling','Sequencing']);});
 it('the label stays "กำลังตรวจวิเคราะห์" and carries the step count to the view',()=>{
  expect(queue(2)).toMatchObject({tone:'testing',label:'กำลังตรวจวิเคราะห์',labSteps:2});
  expect(registryProgress({state:'ReceivedInNIPT',analysis_started:true,round_number:1,received_at:'2026-11-06T04:00:00Z',identityVerified:true,progress:null,labSteps:3})).toMatchObject({tone:'testing',labSteps:3});
 });
 it('the bar shows done / current / waiting sub-steps and a note under it',()=>{
  const out=html(queue(1));
  expect(out).toContain('class="done"');expect(out).toContain('class="now"');
  expect(out).toContain('ขั้นตอนในห้อง Lab 2/4: ตรวจ QC');
  expect(html(queue(0))).toContain('ขั้นตอนในห้อง Lab 1/4: ลง Task List');
  expect(html(queue(3))).toContain('ขั้นตอนในห้อง Lab 4/4: Sequencing');
  expect(html(queue(4))).toContain('ห้อง Lab ตรวจครบทุกขั้นตอนแล้ว รอทวนผลและรับรอง');
 });
 it('without Run information the bar and its note are exactly what they were; other stages never show the steps',()=>{
  expect(html(queue(null))).not.toContain('lab-bars');expect(html(queue(null))).not.toContain('ขั้นตอนในห้อง Lab');
  expect(html(queueProgress({stage:'received',flags:[],hasResult:false,roundState:'ReceivedInNIPT',labSteps:2}))).not.toContain('lab-bars');
  expect(html(queueProgress({stage:'released',flags:[],hasResult:true,roundState:'CertifiedReleased',labSteps:4}))).not.toContain('lab-bars');
 });
});

import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const src=readFileSync('src/components/p4/batch-workspace.tsx','utf8');
const area=src.slice(src.indexOf('function ExactFill('),src.indexOf('function ExactFillArea')+9000);
it('the Task page offers one "เพิ่มตัวอย่าง" panel (normal or Urgent) plus Repeat; no separate Urgent Fill, no typed Urgent reason',()=>{
 expect(area).toContain("(['FILL','REPEAT'] as const)");
 expect(src).not.toContain('Urgent Fill — งานด่วน');
 expect(src).not.toContain("เหตุผลงานด่วน / แทรกคิว");                                          // the Urgent reason prompt is gone
 expect(area).toContain('งานด่วน (Urgent)');                                                    // a tick instead
 expect(area).toContain("mode==='REPEAT'?'REPEAT':makesUrgent?'URGENT':'MANUAL'");              // the old server modes are still what is sent
 expect(area).toContain("action:'previewAssignment'");                                          // a reason is asked only when a normal sample would jump the queue
});

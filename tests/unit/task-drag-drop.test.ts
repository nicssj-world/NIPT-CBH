import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const src=readFileSync('src/components/p4/batch-workspace.tsx','utf8');
it('the Task List rows can be dragged onto another position; no reason is asked to move or swap',()=>{
 expect(src).toContain('{...dnd(s)}');                                                           // every position row takes part
 expect(src).toContain('draggable:draggable&&!!s.assignment&&!s.control');                       // only samples drag; controls never
 expect(src).toContain('!target.control');                                                       // controls are never a drop target
 expect(src).toContain('act("move",{fromSlot:from,toSlot:s.slot}');                             // the drop uses the existing server move, with no reason
 expect(src).not.toContain('mv-reason');                                                         // the dialog no longer asks one either
 expect(src).toContain('aria-label="ย้าย/สลับ" onClick={()=>setDialog({type:"move",slot:s.slot})}');   // the keyboard route stays (an icon button since 2026-11-09; same accessible name)
 expect(src).toContain('aria-label="ถอดออก" onClick={()=>setDialog({type:"remove",slot:s.slot})}');
});

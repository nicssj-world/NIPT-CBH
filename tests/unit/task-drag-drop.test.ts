import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const src=readFileSync('src/components/p4/batch-workspace.tsx','utf8');
it('the Task List rows can be dragged onto another position; no reason is asked to move or swap',()=>{
 expect(src).toContain('{...dnd(s)}');                                                           // every position row takes part
 expect(src).toContain('draggable:draggable&&!!s.assignment&&!s.control');                       // only samples drag; controls never
 expect(src).toContain('!target.control');                                                       // controls are never a drop target
 expect(src).toContain('act("move",{fromSlot:from,toSlot:s.slot}');                             // the drop uses the existing server move, with no reason
 expect(src).not.toContain('mv-reason');                                                         // the dialog no longer asks one either
 expect(src).toContain('ย้าย/สลับ</button>');                                                     // the keyboard route stays
});

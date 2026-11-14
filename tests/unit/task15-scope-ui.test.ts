import {it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
import {Registry} from '../../src/components/p2/registry';
it('ANC removes the department selector and waits for authorized internal scope before registration can submit',()=>{
 const html=renderToStaticMarkup(createElement(Registry,{canAnc:true,canLab:false,initialAncRegistration:true}));
 // The registration dialog has no department selector (Task 1.5). Since 2026-11-14 the registry page itself has a "เรียงตาม" select,
 // so the check is on the dialog's own markup.
 const dialog=html.slice(html.indexOf('<dialog'));
 expect(html.indexOf('<dialog')).toBeGreaterThan(-1);
 expect(html).not.toContain('หน่วยงานลงทะเบียน');expect(dialog).not.toContain('<select');
 expect(html).toMatch(/<button[^>]*disabled=""[^>]*>ตรวจข้อมูลก่อนลงทะเบียน<\/button>/);
});

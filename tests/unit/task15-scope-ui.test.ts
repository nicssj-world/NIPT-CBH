import {it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
import {Registry} from '../../src/components/p2/registry';
it('ANC removes the department selector and waits for authorized internal scope before registration can submit',()=>{
 const html=renderToStaticMarkup(createElement(Registry,{canAnc:true,canLab:false,initialAncRegistration:true}));
 expect(html).not.toContain('หน่วยงานลงทะเบียน');expect(html).not.toContain('<select');
 expect(html).toMatch(/<button[^>]*disabled=""[^>]*>ตรวจข้อมูลก่อนลงทะเบียน<\/button>/);
});

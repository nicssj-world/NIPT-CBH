import {it,expect,vi} from 'vitest';
import {createElement,type ComponentType} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
let current='/confirm';
vi.mock('next/navigation',()=>({usePathname:()=>current,useRouter:()=>({replace(){},refresh(){}})}));
const {AppFrame}=await import('../../src/components/app-frame');

// Owner 2026-11-24: an ANC user who opens ผลตรวจยืนยัน keeps the ANC top-bar menu; the Lab side menu must not take over.
const page=(path:string,ancWorkspace:boolean)=>{current=path;return renderToStaticMarkup(createElement(AppFrame as ComponentType<Record<string,unknown>>,{sidebar:createElement('span',null,'SIDEBAR-MENU'),ancNavigation:createElement('span',null,'ANC-TOP-MENU'),ancUserName:'x',ancWorkspace},createElement('p',null,'body')));};
it('ANC keeps the top-bar menu on /confirm; other roles keep the side menu',()=>{
 const anc=page('/confirm',true);
 expect(anc).toContain('ANC-TOP-MENU');expect(anc).not.toContain('SIDEBAR-MENU');
 const lab=page('/confirm',false);
 expect(lab).toContain('SIDEBAR-MENU');expect(lab).not.toContain('ANC-TOP-MENU');
 expect(page('/anc-stats',true)).toContain('ANC-TOP-MENU');
});

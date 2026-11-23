import {it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('next/navigation',()=>({usePathname:()=>'/confirm',useRouter:()=>({replace(){},refresh(){}})}));
const {Navigation}=await import('../../src/components/navigation');

const base={canSeeCases:true,canSeeSettings:false,canSeeHealth:false};
const links=(html:string)=>[...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1]);
// Owner 2026-11-23: ผลตรวจยืนยัน sits in the "ผลตรวจ" group of the side menu and in the ANC top bar, for whoever may read it.
it('shows the confirm page in the side menu (ผลตรวจ group) and the ANC top bar only with confirm.read',()=>{
 const side=renderToStaticMarkup(createElement(Navigation,{...base,canSeeNhso:true,canSeeConfirm:true}));
 expect(links(side)).toEqual(expect.arrayContaining(['/nhso','/confirm']));
 expect(links(side).indexOf('/confirm')).toBe(links(side).indexOf('/nhso')+1);
 expect(side).toContain('ผลตรวจยืนยัน');expect(side).not.toContain('(Confirm)');   // Owner 2026-11-23: Thai name only
 const anc=renderToStaticMarkup(createElement(Navigation,{...base,canSeeAncStats:true,canSeeConfirm:true,mode:'anc'}));
 expect(links(anc).at(-1)).toBe('/confirm');
 for(const mode of ['global','anc'] as const)expect(links(renderToStaticMarkup(createElement(Navigation,{...base,canSeeConfirm:false,mode})))).not.toContain('/confirm');
});

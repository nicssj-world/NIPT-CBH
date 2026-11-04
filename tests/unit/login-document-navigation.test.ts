import {afterEach,expect,it,vi} from 'vitest';
import type {ReactElement,FormEvent} from 'react';
import {LoginForm} from '../../src/components/login-form';

const router=vi.hoisted(()=>({replace:vi.fn(),refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>router}));
vi.mock('react',async importOriginal=>({...await importOriginal<typeof import('react')>(),useState:(value:unknown)=>[value,vi.fn()],useEffect:vi.fn()}));
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});

it('loads a fresh document after login so previews use the authenticated page CSP',async()=>{
 const replace=vi.fn();
 vi.stubGlobal('window',{location:{replace}});
 vi.stubGlobal('FormData',class {get(key:string){return key==='username'?'synthetic.lab':'synthetic-password';}});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true})}));
 const form=LoginForm() as ReactElement<{onSubmit:(event:FormEvent<HTMLFormElement>)=>Promise<void>}>;
 await form.props.onSubmit({preventDefault:vi.fn(),currentTarget:{}} as unknown as FormEvent<HTMLFormElement>);
 expect(replace).toHaveBeenCalledWith('/');
 expect(router.replace).not.toHaveBeenCalled();
});

it('keeps a rejected login on the sign-in document',async()=>{
 const replace=vi.fn();
 vi.stubGlobal('window',{location:{replace}});
 vi.stubGlobal('FormData',class {get(){return 'invalid';}});
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({error:'invalid login'})}));
 const form=LoginForm() as ReactElement<{onSubmit:(event:FormEvent<HTMLFormElement>)=>Promise<void>}>;
 await form.props.onSubmit({preventDefault:vi.fn(),currentTarget:{}} as unknown as FormEvent<HTMLFormElement>);
 expect(replace).not.toHaveBeenCalled();
});

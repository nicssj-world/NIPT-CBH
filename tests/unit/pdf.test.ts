import {it,expect} from 'vitest';
import {renderFoundationPdf} from '../../packages/pdf/render';
import {FileStore} from '../../packages/storage';
import {mkdtemp,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
it('controlled renderer outputs Thai text and exact stored bytes without executing embedded markup',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'nipt-pdf-'));try{const bytes=await renderFoundationPdf({synthetic:true,reference:'SYNTHETIC-TEST',label:'ทดสอบ <img src="https://invalid.example/a">'});const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const pdf=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;const text=(await (await pdf.getPage(1)).getTextContent()).items.map(x=>'str' in x?x.str:'').join(' ').replace(/\s+/g,' ');expect(text).toContain('SYNTHETIC ONLY');expect(text).toContain('ทดสอบ');expect(text).toContain('<img');const store=new FileStore(root),hash=await store.put(bytes);expect(await store.get(hash)).toEqual(bytes);}finally{await rm(root,{recursive:true,force:true});}},30000);


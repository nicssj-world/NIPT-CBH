// Diagnostic: measured geometry (mm) of the first left/right half of a label sheet file.
import {chromium} from 'playwright';import {readFileSync} from 'node:fs';
const b=await chromium.launch();const p=await b.newPage();await p.setContent(readFileSync(process.argv[2],'utf8'));await p.emulateMedia({media:'print'});
const r=await p.locator('.half').evaluateAll(hs=>hs.slice(0,2).map(h=>{const o=h.getBoundingClientRect();const q=sel=>[...h.querySelectorAll(sel)].map(e=>{const r=e.getBoundingClientRect();return [r.left-o.left,r.top-o.top,r.right-o.left,r.bottom-o.top].map(v=>Math.round(v*25.4/96*100)/100);});return {corners:q('.corner'),text:q('.ln-halos,.patient-ln'),bc:q('.bc')};}));
for(const h of r)console.log(JSON.stringify(h));await b.close();

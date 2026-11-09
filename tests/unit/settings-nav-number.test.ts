import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const src=readFileSync('src/components/settings-editor.tsx','utf8'),css=readFileSync('src/app/globals.css','utf8');
it('settings categories that share a group number are numbered 7.1, 7.2 … (never "7." five times)',()=>{
 expect(src).toContain('navNumber(c.category,c.key)');                 // the list uses the helper
 expect(src).not.toMatch(/\{CATEGORY_NO\[c\.category\]\}\. \{forms/);    // not the raw group number
 expect(src).toContain('`${CATEGORY_NO[cat]}.${group.findIndex(x=>x.key===k)+1}`');
});
it('the coverage table fits its card (no fixed 980 px minimum) and keeps Plan and Phase on one line',()=>{
 expect(css).not.toContain('.coverage-table {min-width:980px;}');
 expect(css).toContain('.coverage-table th:nth-child(2)');
});

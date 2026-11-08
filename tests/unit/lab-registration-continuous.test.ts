import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const src=readFileSync('src/components/p2/lab-registration.tsx','utf8');
it('Lab registration is paper-only and keeps the dialog open for the next LN (Owner 2026-11-09)',()=>{
 expect(src).toContain("consentMode:'Paper'");           // request form and consent are always on paper in the Lab channel
 expect(src).not.toContain("'Electronic'");              // no consent choice in this dialog
 expect(src).not.toContain('router.push');               // the case page no longer replaces the dialog
 expect(src).toContain('lnInput.current?.focus()');      // the next LN can be scanned or typed straight away
 expect(src).toContain('ลงทะเบียนแล้วในรอบนี้');          // registered cases are listed under the form
 expect(src).toContain('key.current=crypto.randomUUID()');// every case gets its own idempotency key
});

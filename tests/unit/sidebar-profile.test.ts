import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
const read=(p:string)=>readFileSync(p,'utf8');
it('the sidebar account is one button that opens the profile popup; changing the password lives in the popup',()=>{
 const layout=read('src/app/(protected)/layout.tsx');
 expect(layout).toContain('<OwnProfile variant="sidebar"');                         // the account row opens the profile
 expect(layout).not.toContain('href="/password"');                                  // no separate change-password link in the sidebar
 const profile=read('src/components/own-profile.tsx');
 expect(profile).toContain("'เปลี่ยนรหัสผ่าน'");                                      // the tab inside the popup
 expect(profile).toContain('<PasswordEditor/>');
 expect(profile).toContain('aria-haspopup="dialog"');                               // announced as opening a dialog
 expect(profile).toContain('createPortal(');                                        // the popup is not a child of the sidebar, so the sidebar's CSS cannot reach it
 const css=read('src/components/ui-backlog-polish.css');
 expect(css).toMatch(/\.sidebar \.session-trigger\{[^}]*min-height:56px/);          // a comfortable touch target
 expect(css).toContain('.sidebar .session-trigger:focus-visible');                  // visible keyboard focus
 expect(read('src/components/p2/shared.tsx')).toContain('dialog?.close();opener?.focus();');   // focus goes back to the button that opened any popup
});

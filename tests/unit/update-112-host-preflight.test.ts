import {it,expect} from 'vitest';
import {existsSync} from 'node:fs';
import path from 'node:path';
it('read-only Windows installer build host prerequisites and old-release artifacts',()=>{
 const inno=[
  process.env.ISCC,
  path.join(process.env.LOCALAPPDATA??'','Programs','Inno Setup 6','ISCC.exe'),
  'C:/Program Files (x86)/Inno Setup 6/ISCC.exe',
  'C:/Program Files/Inno Setup 6/ISCC.exe'
 ].filter((v):v is string=>!!v).find(existsSync);
 const oldVersions=['1.1.1','1.1.0'];
 const parents=[process.cwd(),path.resolve(process.cwd(),'../..'),
  path.join(process.env.USERPROFILE??'C:/Users/User','Downloads'),
  path.join(process.env.USERPROFILE??'C:/Users/User','Desktop')];
 const old=parents.flatMap(root=>oldVersions.flatMap(version=>[
  path.join(root,'.local/p8-win/setup',`NIPT-CBH-Setup-${version}.exe`),
  path.join(root,'.local/p8-win/setup',`NIPT-CBH-Update-${version}.exe`),
  path.join(root,`NIPT-CBH-Setup-${version}.exe`),
  path.join(root,`NIPT-CBH-Update-${version}.exe`)
 ])).filter(existsSync);
 // This test never builds/executes an installer, alters permissions, or reads secrets.
 console.log('INNO_SETUP_COMPILER:',inno?'AVAILABLE':'MISSING');
 console.log('OLD_SETUP_ARTIFACTS_IN_KNOWN_RELEASE_DIRS:',old.map(p=>path.basename(p)).join(',')||'NONE_FOUND');
 expect(existsSync('tools/win-installer/build-setup.ts')).toBe(true);
 expect(existsSync('tools/win-installer/update-rehearsal.ts')).toBe(true);
});

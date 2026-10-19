/** Build the one-click Windows Setup (NIPT-CBH-Setup-<version>.exe) from the clean committed source.
 *    tsx tools/win-installer/build-setup.ts --version 1.0.0 [--skip-build] [--master-workbook <file>] [--out <folder>] [--fast]
 *  1. the signed offline package (build-package.ts) with the approved owner master workbook embedded (hash-checked),
 *  2. Inno Setup (ISCC) wraps that package, the public key and the Thai wizard into ONE .exe,
 *  3. SHA-256, size and manifest facts are written next to it.
 *  The EXE is an offline installer: nothing is downloaded at install time. Inno Setup is a build tool only; it is not shipped.
 *  The Ed25519 key is the developer/test key; the EXE is NOT Authenticode-signed (reported as such). */
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,stat,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseVersion} from './lib.mjs';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:(process.argv[i+1]&&!process.argv[i+1].startsWith('--')?process.argv[i+1]:'true');};
const git=(...a:string[])=>execFileSync('git',a,{encoding:'utf8'}).trim();
const version=arg('version')??'';parseVersion(version);
if(git('status','--porcelain','--untracked-files=normal'))throw Error('CLEAN_COMMITTED_SOURCE_REQUIRED');
const revision=git('rev-parse','HEAD');
const local=path.resolve('.local/p8-win');
const out=path.resolve(arg('out')??path.join(local,'setup'));
const packageDir=path.join(local,'setup-packages','nipt-cbh-'+version);
const master=arg('master-workbook')??process.env.NIPT_TASK_MASTER_PATH??'C:/Users/User/Downloads/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx';
const iscc=[process.env.ISCC,path.join(process.env.LOCALAPPDATA??'','Programs','Inno Setup 6','ISCC.exe'),'C:/Program Files (x86)/Inno Setup 6/ISCC.exe','C:/Program Files/Inno Setup 6/ISCC.exe'].find(p=>p&&existsSync(p));
if(!iscc)throw Error('INNO_SETUP_COMPILER_NOT_FOUND (build host only: winget install JRSoftware.InnoSetup)');
const log=(m:string)=>process.stderr.write('[setup] '+m+'\n');
await mkdir(out,{recursive:true});

if(!existsSync(path.join(packageDir,'manifest.json'))){
 log('building the signed offline package with the master workbook');
 const a=['node_modules/tsx/dist/cli.mjs','tools/win-installer/build-package.ts','--version',version,'--out',packageDir,'--master-workbook',master];
 if(arg('skip-build'))a.push('--skip-build');
 execFileSync(process.execPath,a,{stdio:['ignore','inherit','inherit']});
}else log('reusing the existing package '+packageDir);
const keyFile=path.join(local,'keys','package-signing-public.pem');
const manifestBytes=await readFile(path.join(packageDir,'manifest.json'));
const manifest=JSON.parse(manifestBytes.toString());
if(manifest.revision!==revision)throw Error('PACKAGE_REVISION_DIFFERS_FROM_HEAD (rebuild the package)');
if(!existsSync(path.join(packageDir,'payload','master','approved-master.xlsx')))throw Error('MASTER_WORKBOOK_NOT_EMBEDDED');

log('compiling '+path.basename(iscc)+' (this takes several minutes: the payload is about 1.4 GB)');
const t0=Date.now();
execFileSync(iscc,['/Q',`/DPackageDir=${packageDir}`,`/DKeyFile=${keyFile}`,`/DAppVersion=${version}`,`/DOutDir=${out}`,...(arg('fast')?['/DCompressionFast=1']:[]),path.resolve('tools/win-installer/setup/NIPT-CBH-Setup.iss')],{stdio:['ignore','inherit','inherit']});
const exe=path.join(out,`NIPT-CBH-Setup-${version}.exe`);
const bytes=await readFile(exe);
const record={
 format:'NIPT_SETUP_EXE_RECORD_V1',builtAt:new Date().toISOString(),compileSeconds:Math.round((Date.now()-t0)/1000),
 exe:{path:exe,bytes:(await stat(exe)).size,sha256:createHash('sha256').update(bytes).digest('hex'),requestsAdministrator:bytes.includes(Buffer.from('requireAdministrator')),
  authenticode:'NOT SIGNED (developer/test release; the EXE has no Authenticode signature, so Windows SmartScreen may warn)'},
 innoSetup:path.basename(path.dirname(iscc)),
 package:{path:packageDir,version:manifest.version,revision:manifest.revision,manifestSha256:createHash('sha256').update(manifestBytes).digest('hex'),runtime:manifest.runtime,migrationsSha256:manifest.migrationsSha256,masterWorkbookEmbedded:true},
 source:{head:revision,baselineTag:'baseline-pre-p8-win-20261019'},
 integrity:'The EXE carries the Ed25519-signed package and its public key; the engine verifies signature and the exact file set before it writes anything.'
};
await writeFile(path.join(out,`NIPT-CBH-Setup-${version}.record.json`),JSON.stringify(record,null,2));
process.stdout.write(JSON.stringify({exe:record.exe,compileSeconds:record.compileSeconds,packageManifestSha256:record.package.manifestSha256})+'\n');

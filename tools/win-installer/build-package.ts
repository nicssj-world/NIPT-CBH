/** Build the signed Windows offline package from the clean committed source.
 *    tsx tools/win-installer/build-package.ts --version 1.0.0 [--out <dir>] [--app-only] [--skip-build]
 *        [--extra-migration <file.sql>] [--signing-key <private.pem>] [--min-from <version>] [--test-fault web-exits]
 *  The package is a folder: installer/ (operator CLI), payload/release (app + ops + migrations), payload/runtime (Node, PostgreSQL 17 binaries,
 *  Chromium for the PDF renderer; omitted with --app-only for upgrades), manifest.json + manifest.sig (Ed25519 over every file's SHA-256).
 *  Test environment only: nothing is published, pushed or deployed. `--extra-migration` exists for upgrade rehearsals and is recorded in the manifest. */
import {execFileSync} from 'node:child_process';
import {createHash,generateKeyPairSync,createPublicKey,sign} from 'node:crypto';
import {cp,mkdir,readFile,writeFile,readdir,rm,access,lstat} from 'node:fs/promises';
import path from 'node:path';
import {migrationInventory} from '../../deploy/scripts/release-contract.mjs';
import {directoryHashes,INSTALLER_FORMAT,parseVersion} from './lib.mjs';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:(process.argv[i+1]&&!process.argv[i+1].startsWith('--')?process.argv[i+1]:'true');};
const git=(...a:string[])=>execFileSync('git',a,{encoding:'utf8'}).trim();
const version=arg('version')??'';parseVersion(version);
if(git('status','--porcelain','--untracked-files=normal'))throw Error('CLEAN_COMMITTED_SOURCE_REQUIRED');
const revision=git('rev-parse','HEAD'),appOnly=arg('app-only')==='true',skipBuild=arg('skip-build')==='true';
const localRoot=path.resolve('.local/p8-win');
const out=path.resolve(arg('out')??path.join(localRoot,'packages','nipt-cbh-'+version+(appOnly?'-app':'')));
if(!out.startsWith(localRoot+path.sep))throw Error('PACKAGE_MUST_BE_UNDER_LOCAL_P8_WIN');
try{await lstat(out);throw Error('FRESH_PACKAGE_DIRECTORY_REQUIRED');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const exists=async(p:string)=>{try{await access(p);return true;}catch{return false;}};
const log=(m:string)=>process.stderr.write('[package] '+m+'\n');

// 1. migrations (+ optional test-only extra migration), provenance
const staging=path.join(localRoot,'staging',`${version}-${Date.now()}`);await mkdir(staging,{recursive:true});
const migrationsDir=path.join(staging,'migrations');await cp('db/migrations',migrationsDir,{recursive:true});
const extra=arg('extra-migration');
if(extra){const name=path.basename(extra);if(!/^\d{3}_[a-z0-9_]+\.sql$/.test(name))throw Error('EXTRA_MIGRATION_NAME_INVALID');await cp(extra,path.join(migrationsDir,name));}
const inventory=await migrationInventory(migrationsDir);
const provenance={revision,migrationsSha256:inventory.sha256,migrations:inventory.files};

// 2. build (always from this exact commit unless --skip-build asserts an existing build of it)
if(!skipBuild){
 log('next build');execFileSync(process.platform==='win32'?'npm.cmd':'npm',['run','build'],{stdio:'inherit',shell:process.platform==='win32',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});
}
const standalone=path.resolve('.next/standalone');
if(!await exists(path.join(standalone,'server.js')))throw Error('STANDALONE_BUILD_REQUIRED');
if(git('status','--porcelain','--untracked-files=normal')||git('rev-parse','HEAD')!==revision)throw Error('SOURCE_CHANGED_DURING_BUILD');
const buildId=(await readFile('.next/BUILD_ID','utf8')).trim();

// 3. production dependencies for the operations tools (cached by lock hash)
const lockHash=createHash('sha256').update(await readFile('package-lock.json')).digest('hex').slice(0,16);
const modulesCache=path.join(localRoot,'node_modules-'+lockHash);
if(!await exists(path.join(modulesCache,'node_modules','tsx'))){
 log('installing production dependencies (cached afterwards)');
 await rm(modulesCache,{recursive:true,force:true});await mkdir(modulesCache,{recursive:true});
 await cp('package.json',path.join(modulesCache,'package.json'));await cp('package-lock.json',path.join(modulesCache,'package-lock.json'));
 execFileSync(process.platform==='win32'?'npm.cmd':'npm',['ci','--omit=dev','--no-audit','--no-fund'],{cwd:modulesCache,stdio:'inherit',shell:process.platform==='win32'});
}

// 4. stage the release
const release=path.join(out,'payload','release'),app=path.join(release,'app'),ops=path.join(release,'ops');
await mkdir(app,{recursive:true});await mkdir(ops,{recursive:true});
log('staging app');
// Next's standalone output links externalized packages (e.g. argon2) through hashed symlinks; a package must hold real files (creating a symlink needs a privilege on the target).
await cp(standalone,app,{recursive:true,dereference:true,filter:s=>!/[\\/]\.local([\\/]|$)/.test(s)});
await cp('.next/static',path.join(app,'.next','static'),{recursive:true});
await cp('public',path.join(app,'public'),{recursive:true});
await mkdir(path.join(app,'tools'),{recursive:true});await cp('tools/runtime-env.mjs',path.join(app,'tools','runtime-env.mjs'));
await rm(path.join(app,'db','migrations'),{recursive:true,force:true});await mkdir(path.join(app,'db'),{recursive:true});await cp(migrationsDir,path.join(app,'db','migrations'),{recursive:true});
await writeFile(path.join(app,'build-provenance.json'),JSON.stringify(provenance));
const testFault=arg('test-fault');
if(testFault){if(testFault!=='web-exits')throw Error('TEST_FAULT_UNKNOWN');await writeFile(path.join(app,'server.js'),'process.exit(1);');} // rehearsal-only: a release whose web process cannot stay up
log('staging operations tools');
for(const d of ['apps','packages']){await cp(d,path.join(ops,d),{recursive:true});}
await mkdir(path.join(ops,'db'),{recursive:true});await cp(migrationsDir,path.join(ops,'db','migrations'),{recursive:true});
await mkdir(path.join(ops,'deploy'),{recursive:true});await cp('deploy/scripts',path.join(ops,'deploy','scripts'),{recursive:true});
await mkdir(path.join(ops,'tools'),{recursive:true});
for(const f of ['migrate.ts','migration-checksums.ts','configure-operational.ts','runtime-env.mjs'])await cp(path.join('tools',f),path.join(ops,'tools',f));
await mkdir(path.join(ops,'tools','operational'),{recursive:true});await cp('tools/operational/native-excel-bridge.ps1',path.join(ops,'tools','operational','native-excel-bridge.ps1'));
for(const d of ['p8','win-installer'])await cp(path.join('tools',d),path.join(ops,'tools',d),{recursive:true,filter:s=>!/build-package\.ts$/.test(s)});
for(const f of ['package.json','package-lock.json','tsconfig.json'])await cp(f,path.join(ops,f));
await cp(path.join(modulesCache,'node_modules'),path.join(ops,'node_modules'),{recursive:true});
await writeFile(path.join(ops,'build-provenance.json'),JSON.stringify(provenance));
await writeFile(path.join(release,'release.json'),JSON.stringify({version,revision,buildId,migrationsSha256:inventory.sha256,migrationCount:Object.keys(inventory.files).length,migrations:inventory.files,extraTestMigration:extra?path.basename(extra):null,createdAt:git('log','-1','--format=%cI')},null,2)); // commit time, not wall-clock: packaging the same build twice is byte-identical

// 5. runtime (full packages only)
let runtime:Record<string,string>|undefined;
if(!appOnly){
 log('staging runtime (Node, PostgreSQL binaries, Chromium)');
 const pgHome=process.env.NIPT_PG_HOME??'C:/Program Files/pgsql';
 const rt=path.join(out,'payload','runtime');
 await mkdir(path.join(rt,'node'),{recursive:true});await cp(process.execPath,path.join(rt,'node','node.exe'));
 for(const d of ['bin','lib','share'])await cp(path.join(pgHome,d),path.join(rt,'pg',d),{recursive:true});
 const browsers=JSON.parse(await readFile('node_modules/playwright-core/browsers.json','utf8')).browsers as {name:string;revision:string}[];
 const shell=browsers.find(b=>b.name==='chromium-headless-shell');if(!shell)throw Error('CHROMIUM_HEADLESS_SHELL_REVISION_UNKNOWN');
 const cache=process.env.PLAYWRIGHT_BROWSERS_PATH??path.join(process.env.LOCALAPPDATA??'','ms-playwright'),folder=`chromium_headless_shell-${shell.revision}`;
 if(!await exists(path.join(cache,folder)))throw Error('CHROMIUM_NOT_INSTALLED_ON_BUILD_HOST');
 await cp(path.join(cache,folder),path.join(rt,'browsers',folder),{recursive:true});
 // PowerShell 7 runs the native Excel export (the script needs .NET 5+ APIs); bundling it removes a host prerequisite
 const pwshHome=process.env.NIPT_PWSH_HOME??'C:/Program Files/PowerShell/7';
 if(!await exists(path.join(pwshHome,'pwsh.exe')))throw Error('POWERSHELL7_NOT_INSTALLED_ON_BUILD_HOST');
 await cp(pwshHome,path.join(rt,'pwsh'),{recursive:true});
 runtime={pwsh:execFileSync(path.join(pwshHome,'pwsh.exe'),['-NoLogo','-NoProfile','-Command','$PSVersionTable.PSVersion.ToString()'],{encoding:'utf8'}).trim(),node:process.version,postgres:execFileSync(path.join(pgHome,'bin','postgres.exe'),['--version'],{encoding:'utf8'}).trim(),chromium:folder};
 await writeFile(path.join(rt,'runtime.json'),JSON.stringify(runtime));
}

// 6. installer + documentation
await mkdir(path.join(out,'installer'),{recursive:true});
for(const f of await readdir('tools/win-installer'))if(/\.(mjs|ps1)$/.test(f))await cp(path.join('tools/win-installer',f),path.join(out,'installer',f));
await mkdir(path.join(out,'docs'),{recursive:true});
for(const f of ['docs/p8/windows-installer.md','docs/p8/windows-installer-runbook.md'])if(await exists(f))await cp(f,path.join(out,'docs',path.basename(f)));

// 7. sign
let keyFile=arg('signing-key');
if(!keyFile){
 keyFile=path.join(localRoot,'keys','package-signing-private.pem');
 if(!await exists(keyFile)){await mkdir(path.dirname(keyFile),{recursive:true});const k=generateKeyPairSync('ed25519',{privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});await writeFile(keyFile,k.privateKey,{mode:0o600});await writeFile(keyFile.replace('private','public'),k.publicKey);}
}
const privateKey=await readFile(keyFile,'utf8');
const publicFile=keyFile.replace('private','public');
if(!await exists(publicFile))await writeFile(publicFile,createPublicKey(privateKey).export({type:'spki',format:'pem'}));
const files=await directoryHashes(out);
const manifest={format:INSTALLER_FORMAT,version,revision,migrationsSha256:inventory.sha256,testEnvironmentOnly:true,runtimeIncluded:!appOnly,runtime:runtime??null,minFromVersion:arg('min-from')??null,extraTestMigration:extra?path.basename(extra):null,testFault:testFault??null,files};
const raw=Buffer.from(JSON.stringify(manifest));
await writeFile(path.join(out,'manifest.json'),raw);await writeFile(path.join(out,'manifest.sig'),sign(null,raw,privateKey));
await rm(staging,{recursive:true,force:true});
process.stdout.write(JSON.stringify({package:out,version,revision,appOnly,fileCount:Object.keys(files).length,publicKey:publicFile,migrations:Object.keys(inventory.files).length})+'\n');

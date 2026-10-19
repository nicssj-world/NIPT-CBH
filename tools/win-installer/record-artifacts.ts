/** Release-record generator: describes the Windows offline package that was actually built and tested, so the release record is checked
 *  against the files, not typed by hand. Verifies the Ed25519 signature with the public key, hashes the manifest and key, lists runtime
 *  versions and the migration inventory (001–104) with checksums, and states the Git ancestry of the recorded commit.
 *    tsx tools/win-installer/record-artifacts.ts --package <dir> --public-key <pem> [--zip <file.zip>] --out docs/release/artifact-record.json
 *  Ed25519 package signing protects integrity and origin-of-build against tampering. It is NOT Windows Authenticode code-signing. */
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,stat,readdir} from 'node:fs/promises';
import {createHash,createPublicKey} from 'node:crypto';
import path from 'node:path';
import {verifyPackage,sha256File} from './lib.mjs';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);return i<0?undefined:process.argv[i+1];};
const pkg=path.resolve(arg('package')??'');const key=path.resolve(arg('public-key')??'');const out=arg('out');
const git=(...a:string[])=>execFileSync('git',a,{encoding:'utf8'}).trim();
const manifest=await verifyPackage(pkg,key);            // throws unless signature and the exact file set verify
const raw=await readFile(path.join(pkg,'manifest.json'));
const release=JSON.parse(await readFile(path.join(pkg,'payload','release','release.json'),'utf8')) as {version:string;revision:string;buildId:string;migrationCount:number;migrations:Record<string,string>;createdAt:string};
const runtime=manifest.runtime;
const head=git('rev-parse','HEAD');
const ancestor=(c:string)=>{try{execFileSync('git',['merge-base','--is-ancestor',c,'HEAD']);return true;}catch{return false;}};
const dirSize=async(d:string):Promise<number>=>{let n=0;for(const e of await readdir(d,{withFileTypes:true})){const p=path.join(d,e.name);n+=e.isDirectory()?await dirSize(p):(await stat(p)).size;}return n;};
const zip=arg('zip');
const record={
 format:'NIPT_WINDOWS_RELEASE_RECORD_V1',
 recordedAt:new Date().toISOString(),
 package:{name:path.basename(pkg),path:pkg,version:manifest.version,runtimeIncluded:manifest.runtimeIncluded,fileCount:Object.keys(manifest.files).length,bytes:await dirSize(pkg),
  manifestSha256:createHash('sha256').update(raw).digest('hex'),signatureSha256:await sha256File(path.join(pkg,'manifest.sig')),
  ...(zip?{zip:{path:path.resolve(zip),bytes:(await stat(zip)).size,sha256:await sha256File(zip)}}:{})},
 signature:{algorithm:'Ed25519',verified:true,publicKeySha256:createHash('sha256').update(createPublicKey(await readFile(key)).export({type:'spki',format:'der'})).digest('hex'),
  note:'Ed25519 package-integrity signing only. This is not Windows Authenticode code-signing and does not establish publisher identity to SmartScreen/AppLocker.'},
 source:{revisionInPackage:manifest.revision,gitHeadNow:head,packageRevisionIsAncestorOfHead:ancestor(manifest.revision),
  baselineTag:'baseline-pre-p8-win-20261019',baselineIsAncestorOfPackageRevision:(()=>{try{execFileSync('git',['merge-base','--is-ancestor','baseline-pre-p8-win-20261019',manifest.revision]);return true;}catch{return false;}})(),
  note:'The package records the commit it was built from. Commits after that commit may contain only documentation/rehearsal evidence; compare the manifest hash, not the HEAD, to identify the artifact.'},
 build:{nextBuildId:release.buildId,createdAt:release.createdAt},
 runtime,
 migrations:{count:release.migrationCount,first:Object.keys(release.migrations)[0],last:Object.keys(release.migrations).at(-1),inventorySha256:manifest.migrationsSha256,files:release.migrations,extraTestMigration:(manifest as {extraTestMigration?:string|null}).extraTestMigration??null},
 testEnvironmentOnly:manifest.testEnvironmentOnly
};
if(out)await writeFile(out,JSON.stringify(record,null,2));
process.stdout.write(JSON.stringify({package:record.package.name,manifestSha256:record.package.manifestSha256,fileCount:record.package.fileCount,bytes:record.package.bytes,signatureVerified:true,runtime,migrations:release.migrationCount,ancestorOfHead:record.source.packageRevisionIsAncestorOfHead,baselineAncestor:record.source.baselineIsAncestorOfPackageRevision})+'\n');

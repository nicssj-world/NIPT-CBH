import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash,X509Certificate} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import https from 'node:https';
import type {AddressInfo} from 'node:net';
import path from 'node:path';
import {authorize} from '../../packages/security/policy';
import {describeCertificate,servedCertificate} from '../../src/server/certificate';

let dir:string,der:Buffer,server:https.Server,origin:string;
const fixtureRoot=path.resolve('.local/dev');
const hex=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex').toUpperCase().match(/../g)!.join(':');

function opensslPath(){
 if(process.platform==='win32'){
  const gitExecPath=execFileSync('git',['--exec-path'],{encoding:'utf8'}).trim();
  const bundled=path.resolve(gitExecPath,'../../../usr/bin/openssl.exe');
  if(existsSync(bundled))return bundled;
 }
 return 'openssl';
}

beforeAll(async()=>{
 mkdirSync(fixtureRoot,{recursive:true});
 dir=mkdtempSync(path.join(fixtureRoot,'nipt-cert-test-'));
 const keyPath=path.join(dir,'tls.key'),certPath=path.join(dir,'tls.crt');
 // Use temporary synthetic TLS material so the test can run without a Windows certificate store.
 execFileSync(opensslPath(),['req','-x509','-newkey','rsa:2048','-sha256','-nodes','-days','200',
  '-subj','/CN=nipt-test.local','-keyout',keyPath,'-out',certPath],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 const cert=readFileSync(certPath);
 der=new X509Certificate(cert).raw;
 server=https.createServer({key:readFileSync(keyPath),cert},(_,res)=>res.end('ok'));
 await new Promise<void>((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',resolve);
 });
 origin=`https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async()=>{
 if(server?.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
 if(dir&&path.dirname(dir)===fixtureRoot)rmSync(dir,{recursive:true,force:true});
});

describe('HTTPS certificate settings',()=>{
 it('downloads exactly the certificate the listener serves (public DER bytes only)',async()=>{
  const served=await servedCertificate(origin);
  expect(served.der.equals(der)).toBe(true);
  expect(served.der.toString('latin1')).not.toContain('PRIVATE KEY');
 });
 it('reports subject, issuer, fingerprint, type and validity from the real certificate',async()=>{
  const info=describeCertificate((await servedCertificate(origin)).der,'127.0.0.1');
  expect(info.sha256).toBe(hex(der));
  expect(info.commonName).toBe('nipt-test.local');
  expect(info.issuer).toContain('CN=nipt-test.local');
  expect(info.type).toBe('SELF_SIGNED');
  expect(info.status).toBe('VALID');
  expect(info.daysLeft).toBeGreaterThanOrEqual(198);expect(info.daysLeft).toBeLessThanOrEqual(200);
 });
 it('warns within 30 days of expiry and reports expired or not-yet-valid',()=>{
  const base=describeCertificate(der,'h'),to=new Date(base.validTo).getTime(),day=86_400_000;
  expect(describeCertificate(der,'h',new Date(to-31*day)).status).toBe('VALID');
  expect(describeCertificate(der,'h',new Date(to-30*day)).status).toBe('EXPIRING_SOON');
  expect(describeCertificate(der,'h',new Date(to-5*day)).status).toBe('EXPIRING_SOON');
  const expired=describeCertificate(der,'h',new Date(to+2*day));
  expect(expired.status).toBe('EXPIRED');expect(expired.daysLeft).toBeLessThan(0);
  expect(describeCertificate(der,'h',new Date(new Date(base.validFrom).getTime()-day)).status).toBe('NOT_YET_VALID');
 });
 it('only follows this environment\'s APP_ORIGIN: refuses missing, malformed and plain-HTTP origins',async()=>{
  await expect(servedCertificate('')).rejects.toThrow('APP_ORIGIN_NOT_SET');
  await expect(servedCertificate('not a url')).rejects.toThrow('APP_ORIGIN_INVALID');
  await expect(servedCertificate('http://127.0.0.1:3000')).rejects.toThrow('HTTPS_NOT_ENABLED');
  await expect(servedCertificate('https://127.0.0.1:1')).rejects.toThrow('TLS_UNAVAILABLE');
 });
 it('is limited to APP_ADMIN on the server and cannot be steered by the caller',()=>{
  const principal=(role:string)=>({id:'u',roles:[role]}) as unknown as Parameters<typeof authorize>[0];
  expect(authorize(principal('APP_ADMIN'),'settings.read',{},'read')).toBe(true);
  for(const role of ['LAB_OPERATOR','ANC_USER','LAB_SUPERVISOR','REPORT_SIGNER'])expect(authorize(principal(role),'settings.read',{},'read')).toBe(false);
  for(const file of ['route.ts','download/route.ts']){
   const source=readFileSync(path.join(__dirname,'../../src/app/api/settings/certificate',file),'utf8');
   expect(source).toContain("protect(request,'settings.read')");
   expect(source).not.toMatch(/searchParams|readJson|request\.json|readFileSync|process\.env\.NIPT_TLS|PRIVATE|\.pfx|passphrase/i);
  }
  expect(readFileSync(path.join(__dirname,'../../src/app/api/settings/certificate/route.ts'),'utf8')).toContain("'Cache-Control':'no-store'");
  expect(readFileSync(path.join(__dirname,'../../src/app/api/settings/certificate/download/route.ts'),'utf8')).toContain("'Cache-Control':'no-store'");
 });
});

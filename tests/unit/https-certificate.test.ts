import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,readFileSync as read,rmSync} from 'node:fs';
import https from 'node:https';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {authorize} from '../../packages/security/policy';
import {describeCertificate,servedCertificate} from '../../src/server/certificate';

let dir:string,der:Buffer,server:https.Server,origin:string;
const hex=(buffer:Buffer)=>createHash('sha256').update(buffer).digest('hex').toUpperCase().match(/../g)!.join(':');

beforeAll(async()=>{
 dir=mkdtempSync(path.join(tmpdir(),'nipt-cert-test-'));
 const pfx=path.join(dir,'t.pfx'),cer=path.join(dir,'t.cer'),pass='synthetic-test-only';
 // Synthetic self-signed certificate (same cmdlet the installer uses), created for this test only and removed from the store at once.
 const script=`$c=New-SelfSignedCertificate -Subject 'CN=nipt-test.local' -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays(200) -CertStoreLocation Cert:\\CurrentUser\\My -KeyExportPolicy Exportable;`+
  `try{Export-PfxCertificate -Cert $c -FilePath '${pfx}' -Password (ConvertTo-SecureString '${pass}' -AsPlainText -Force)|Out-Null;Export-Certificate -Cert $c -FilePath '${cer}' -Type CERT|Out-Null}finally{Remove-Item ('Cert:\\CurrentUser\\My\\'+$c.Thumbprint) -Force}`;
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{stdio:'ignore'});
 der=readFileSync(cer);
 server=https.createServer({pfx:readFileSync(pfx),passphrase:pass},(_,res)=>res.end('ok'));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 origin=`https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(()=>{server?.close();if(dir)rmSync(dir,{recursive:true,force:true});});

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
   const source=read(path.join(__dirname,'../../src/app/api/settings/certificate',file),'utf8');
   expect(source).toContain("protect(request,'settings.read')");
   expect(source).not.toMatch(/searchParams|readJson|request\.json|readFileSync|process\.env\.NIPT_TLS|PRIVATE|\.pfx|passphrase/i);
  }
  expect(read(path.join(__dirname,'../../src/app/api/settings/certificate/route.ts'),'utf8')).toContain("'Cache-Control':'no-store'");
  expect(read(path.join(__dirname,'../../src/app/api/settings/certificate/download/route.ts'),'utf8')).toContain("'Cache-Control':'no-store'");
 });
});

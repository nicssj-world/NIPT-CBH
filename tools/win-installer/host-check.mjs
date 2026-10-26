// NIPT-CBH hospital host check (READ-ONLY): run on the target Windows host before and after installation. Node built-ins only.
//   node host-check.mjs [--root C:\NIPT-CBH] [--backup-path D:\or\\nas\share] [--photo-path ...] [--inbound ...] [--outbound ...]
//                       [--ports 5432,3000,443,3001] [--hostname nipt.hospital.local] [--cert C:\path\server.cer] [--report out.md] [--out out.json]
// It changes nothing except short-lived probe files it creates and deletes inside the paths you name. It reports PASS / WARN / FAIL / INFO with a remedy.
// Thresholds are indicative developer recommendations; hospital IT owns the real sizing and security policy.
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const argv=process.argv.slice(2);
const arg=n=>{const i=argv.indexOf('--'+n);return i<0?undefined:argv[i+1];};
const SYS=process.env.SystemRoot??'C:\\Windows';
const psExe=path.join(SYS,'System32','WindowsPowerShell','v1.0','powershell.exe');
// Windows PowerShell 5.1 started from a PowerShell 7 session inherits PSModulePath entries for PowerShell 7 and then cannot load its own
// Security module (the Cert: drive disappears). Always give it the Windows PowerShell module path only. (Found when Setup was started from pwsh.)
const psEnv=()=>({...process.env,PSModulePath:[path.join(process.env.USERPROFILE??'','Documents','WindowsPowerShell','Modules'),path.join(process.env.ProgramFiles??'C:\\Program Files','WindowsPowerShell','Modules'),path.join(SYS,'System32','WindowsPowerShell','v1.0','Modules')].join(';')});
const ps=script=>{try{return execFileSync(psExe,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:60000,env:psEnv()}).trim();}catch{return null;}};
const results=[];
const add=(id,status,detail,remedy='')=>results.push({id,status,detail,remedy});
const GB=1024**3;

// ── operating system and hardware ──
const osInfo=ps("$o=Get-CimInstance Win32_OperatingSystem;[pscustomobject]@{caption=$o.Caption;version=$o.Version;build=[int]$o.BuildNumber;sku=$o.OperatingSystemSKU}|ConvertTo-Json -Compress");
if(osInfo){const o=JSON.parse(osInfo);add('windows_version',o.build>=17763?'PASS':'FAIL',`${o.caption} ${o.version}`,'Windows 10 1809 / Server 2019 or newer is required (Node 24, PostgreSQL 17).');}
else add('windows_version','FAIL','could not query the operating system','Run on the target Windows host.');
const ramGb=os.totalmem()/GB;
add('memory',ramGb>=16?'PASS':ramGb>=8?'WARN':'FAIL',`${ramGb.toFixed(1)} GB`,'Indicative: 8 GB minimum, 16 GB or more recommended (PostgreSQL, web, worker, renderer + Chromium, Excel). IT to confirm sizing.');
add('cpu',os.cpus().length>=4?'PASS':'WARN',`${os.cpus().length} logical processors`,'Indicative: 4 or more.');
const elevated=(()=>{try{execFileSync(path.join(SYS,'System32','net.exe'),['session'],{windowsHide:true,stdio:'ignore'});return true;}catch{return false;}})();
add('administrator',elevated?'PASS':'WARN',elevated?'elevated prompt':'not elevated','A SYSTEM startup task, a Windows Firewall rule and some ACL changes need an elevated prompt; run the installer as Administrator.');
add('account',os.userInfo().username?'INFO':'WARN',ps('whoami')??'unknown','The installing user owns the secrets folder; with -TaskMode user the services also run as this user.');

// ── paths: exist or creatable, writable, free space, Thai/space handling, UNC ──
const paths={root:arg('root'),'backup-path':arg('backup-path'),'photo-path':arg('photo-path'),inbound:arg('inbound'),outbound:arg('outbound')};
for(const [name,p] of Object.entries(paths)){
 if(!p){add('path_'+name,'INFO','not specified','Name it with --'+name+' to test it.');continue;}
 const abs=path.resolve(p);const unc=abs.startsWith('\\\\');
 if(name==='backup-path'&&!/^[ -~]+$/.test(abs)){add('path_'+name,'FAIL',abs+': contains characters outside ASCII','pg_dump.exe writes the dump through the ANSI command line and fails on such a path: use an ASCII folder name for the backup destination.');continue;}
 try{
  mkdirSync(abs,{recursive:true});
  const probe=path.join(abs,'nipt-hostcheck-'+process.pid+'.tmp'),thai=path.join(abs,'ทดสอบ ไฟล์ '+process.pid+'.tmp');
  writeFileSync(probe,'x');writeFileSync(thai,'ภาษาไทย');const ok=readFileSync(thai,'utf8')==='ภาษาไทย';rmSync(probe);rmSync(thai);
  add('path_'+name,ok?'PASS':'FAIL',`${abs}${unc?' (UNC)':''}: create/write/read/delete incl. a Thai file name`,unc?'For a UNC path the service account (not only the installing user) needs Modify rights on the share and the folder; test as that account.':'');
 }catch(e){add('path_'+name,'FAIL',`${abs}: ${e.code??e.message}`,'Create the folder and grant the service account Modify rights.');}
 if(!unc&&/^[a-z]:/i.test(abs)){
  const free=ps(`(Get-PSDrive -Name '${abs[0]}').Free`);
  if(free){const g=Number(free)/GB;add('disk_'+name,g>=20?'PASS':g>=8?'WARN':'FAIL',`${g.toFixed(1)} GB free on ${abs[0]}:`,'Indicative: the installation needs about 8 GB before data; plan backups and photos separately.');}
 }
}
add('long_paths',ps("(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem' -ErrorAction SilentlyContinue).LongPathsEnabled")==='1'?'PASS':'INFO','LongPathsEnabled registry value','Not required by the installer; keep installation paths short.');

// ── network: ports, firewall, address, DNS ──
const ports=(arg('ports')??'5432,3000,443,3001').split(',').map(Number);
const free=p=>new Promise(r=>{const s=net.createServer();s.once('error',()=>r(false));s.listen(p,'0.0.0.0',()=>s.close(()=>r(true)));});
for(const [i,p] of ports.entries()){const label=['postgres(loopback)','web(loopback)','https(LAN)','renderer(loopback)'][i]??'extra';add('port_'+p,await free(p)?'PASS':'FAIL',`${label} port ${p} ${await free(p)?'free':'in use'}`,'Choose another port with -Ports or stop the process using it.');}
const httpsPort=ports[2]??443;
const profiles=ps('Get-NetFirewallProfile | ForEach-Object { $_.Name + "=" + $_.Enabled }');
add('firewall_profiles',profiles?'INFO':'WARN',profiles?profiles.split(/\r?\n/).join(', '):'could not query','');
const rule=ps(`(Get-NetFirewallRule -DisplayName 'NIPT-CBH HTTPS*' -ErrorAction SilentlyContinue | Measure-Object).Count`);
add('firewall_rule_https_lan',Number(rule)>0?'PASS':'INFO',Number(rule)>0?'an inbound rule named "NIPT-CBH HTTPS*" exists':'no inbound rule for the HTTPS port (only needed for LAN access)',`Elevated: New-NetFirewallRule -DisplayName 'NIPT-CBH HTTPS (LAN)' -Direction Inbound -Protocol TCP -LocalPort ${httpsPort} -Action Allow -Profile Domain,Private -RemoteAddress <hospital subnet>. Never open PostgreSQL, web, or renderer ports.`);
const nics=os.networkInterfaces();const v4=Object.entries(nics).flatMap(([n,a])=>(a??[]).filter(x=>x.family==='IPv4'&&!x.internal).map(x=>`${n}:${x.address}`));
add('ipv4_addresses',v4.length?'INFO':'WARN',v4.join(', ')||'none','The HTTPS front listens on 127.0.0.1 by default; LAN publication is a hospital IT decision (set NIPT_HTTPS_HOST).');
const dhcp=ps("(Get-NetIPInterface -AddressFamily IPv4 | Where-Object {$_.ConnectionState -eq 'Connected' -and $_.InterfaceAlias -notmatch 'Loopback'} | ForEach-Object { $_.InterfaceAlias+'='+$_.Dhcp }) -join ', '");
add('address_assignment',dhcp&&/Enabled/.test(dhcp)?'WARN':'INFO',dhcp??'unknown','A server should have a static address or a DHCP reservation so the certificate name and clients keep working.');
const host=arg('hostname');
if(host){const dns=ps(`(Resolve-DnsName -Name '${host.replace(/'/g,"''")}' -Type A -ErrorAction SilentlyContinue | ForEach-Object IPAddress) -join ','`);const mine=v4.map(x=>x.split(':')[1]);add('dns_hostname',dns&&dns.split(',').some(a=>mine.includes(a))?'PASS':'FAIL',`${host} -> ${dns||'does not resolve'}; this host: ${mine.join(',')}`,'Create the DNS A record for the hostname that is in the certificate.');}
else add('dns_hostname','INFO','no --hostname given','Name the hostname users will type.');

// ── time ──
const w32=ps('w32tm /query /status');
const source=w32&&/Source:\s*(.+)/.exec(w32)?.[1]?.trim();
add('time_sync',source&&!/Local CMOS|Free-running/i.test(source)?'PASS':'WARN',source?`time source: ${source}`:'w32tm unavailable','Audit timestamps and the 5-second HIS polling depend on synchronized time (domain controller or the hospital NTP server).');
add('time_zone',ps('(Get-TimeZone).Id')==='SE Asia Standard Time'?'PASS':'WARN',ps('(Get-TimeZone).Id')??'unknown','Receive times and LN Halos month boundaries use Asia/Bangkok; the host time zone should be SE Asia Standard Time.');

// ── certificate ──
const cert=arg('cert');
if(cert){
 const info=ps(`$c=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2('${path.resolve(cert).replace(/'/g,"''")}');$ch=New-Object System.Security.Cryptography.X509Certificates.X509Chain;$ch.ChainPolicy.RevocationMode='NoCheck';$ok=$ch.Build($c);[pscustomobject]@{subject=$c.Subject;notAfter=$c.NotAfter.ToString('o');days=[int]($c.NotAfter-(Get-Date)).TotalDays;san=(($c.Extensions|Where-Object{$_.Oid.Value -eq '2.5.29.17'}|ForEach-Object{$_.Format($false)}) -join ';');chainOk=$ok;selfSigned=($c.Subject -eq $c.Issuer)}|ConvertTo-Json -Compress`);
 if(info){const c=JSON.parse(info);add('tls_certificate_validity',c.days>=30?'PASS':c.days>=0?'WARN':'FAIL',`${c.subject}, expires ${c.notAfter} (${c.days} days)`,'Renew at least 30 days before expiry.');add('tls_certificate_name',host&&c.san.toLowerCase().includes(host.toLowerCase())?'PASS':'WARN',c.san||'no subject alternative name','The certificate must name the hostname users type (SAN).');add('tls_certificate_trust',c.chainOk&&!c.selfSigned?'PASS':'WARN',c.selfSigned?'self-signed (the installer test certificate)':c.chainOk?'chain builds':'chain does not build','Use a certificate from the hospital CA and make clients trust the chain; the installer test certificate is for test environments only.');}
 else add('tls_certificate','FAIL','could not read the certificate','Provide a .cer/.crt file.');
}else add('tls_certificate','INFO','no --cert given','Provide the hospital certificate (.cer) to check validity, name and chain.');

// ── Office / Excel / PowerShell / printer ──
const excel=(()=>{try{return execFileSync(path.join(SYS,'System32','reg.exe'),['query','HKCR\\Excel.Application\\CurVer'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).includes('Excel.Application');}catch{return false;}})();
add('excel_installed',excel?'PASS':'FAIL',excel?'Excel.Application is registered':'Excel is not registered','Task List PDFs are rendered by the desktop Microsoft Excel (A4, locked template). Install Office/Excel on the host (licensed by the hospital).');
const word=(()=>{try{return execFileSync(path.join(SYS,'System32','reg.exe'),['query','HKCR\\Word.Application\\CurVer'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).includes('Word.Application');}catch{return false;}})();
add('word_installed',word?'PASS':'FAIL',word?'Word.Application is registered':'Word is not registered','The signed NIPT result PDF (name, licence number, signature images) is rendered by the desktop Microsoft Word. Install Office/Word on the host (licensed by the hospital).');
const winlogon=(name)=>ps("(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -Name "+name+" -ErrorAction SilentlyContinue)."+name);
const autoLogon=winlogon('AutoAdminLogon'),autoUser=winlogon('DefaultUserName');
add('unattended_office_session',autoLogon==='1'?'INFO':'WARN',autoLogon==='1'?'Windows automatic sign-in is configured for '+(autoUser||'(unknown)')+' (read only, no password read)':'No automatic Windows sign-in is configured','Word/Excel PDFs need an interactive Windows session. After a power loss or reboot nobody may be logged on: either configure automatic sign-in of the dedicated NIPT Windows account (hospital IT decision) or accept that PDF export waits until that account signs in. Run office-check after the reboot to prove it.');
add('excel_session',excel?'INFO':'INFO','Excel automation is not supported from a service or SYSTEM session (session 0). With a SYSTEM startup task use -ExcelMode bridge and a logged-on interactive user running the bridge task; with -TaskMode user the services run in that user session.','');
const printer=ps("(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -Name Device -ErrorAction SilentlyContinue).Device");
add('default_printer_current_user',printer?'PASS':'WARN',printer??'no default printer for this user','The export script reads the signed-in user default printer and sets it to A4; the account that runs Excel needs a default printer (a PDF printer is enough). Check it as that account.');
add('powershell7',existsSync('C:\\Program Files\\PowerShell\\7\\pwsh.exe')?'INFO':'INFO','The package bundles PowerShell 7; the host does not need it.','');

// ── endpoint security ──
const av=ps("Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct -ErrorAction SilentlyContinue | ForEach-Object displayName");
add('antivirus_products',av?'INFO':'INFO',av?av.split(/\r?\n/).join(', '):'not reported (server SKU or no Security Center)','');
const excl=ps('(Get-MpPreference -ErrorAction SilentlyContinue).ExclusionPath -join ";"');
add('defender_exclusions',excl===null?'INFO':excl?'INFO':'INFO',excl===null?'not readable without elevation':(excl||'none configured'),'Hospital security decides. Scanning the PostgreSQL data folder and photo roots in real time can slow the database and corrupt nothing; if exclusions are approved, apply them to the data and photo folders only, never to the application or secrets.');

const summary=results.reduce((a,r)=>{a[r.status]=(a[r.status]??0)+1;return a;},{});
const report={tool:'NIPT-CBH host check',host:os.hostname(),at:new Date().toISOString(),summary,results,note:'Read-only. Indicative thresholds; hospital IT owns sizing and security policy. PASS here is not hospital acceptance.'};
const out=arg('out');if(out)writeFileSync(out,JSON.stringify(report,null,2));
const md=arg('report');
if(md)writeFileSync(md,['# NIPT-CBH host check',`Host: ${report.host}  ·  ${report.at}`,'',`Summary: ${JSON.stringify(summary)}`,'','| Check | Status | Detail | Remedy |','|---|---|---|---|',...results.map(r=>`| ${r.id} | ${r.status} | ${String(r.detail).replace(/\|/g,'/')} | ${String(r.remedy).replace(/\|/g,'/')} |`)].join('\n'));
process.stdout.write(JSON.stringify({summary,failed:results.filter(r=>r.status==='FAIL').map(r=>r.id),warned:results.filter(r=>r.status==='WARN').map(r=>r.id)})+'\n');
if(summary.FAIL)process.exitCode=1;

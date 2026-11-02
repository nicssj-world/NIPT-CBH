// Individual, read-only checks shared by `npm run dev:verify` (subset) and `npm run release:preflight` (all). Each returns one result
// {id,title,status,...} in the shape of tools/dev/lib.mjs. A prerequisite that is not available gives BLOCKED, never PASS.
import {readFileSync,existsSync,statfsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {repoRoot,git,passed,failed,blocked,readJson} from '../dev/lib.mjs';

const sha256File=f=>createHash('sha256').update(readFileSync(f)).digest('hex');
const t=()=>Date.now();

/** package.json engines.node (">=24 <25") against the running Node. */
export function checkNode(){
 const t0=t();const engines=readJson(path.join(repoRoot,'package.json')).engines?.node??'';
 const [major]=process.versions.node.split('.').map(Number);
 const min=Number(/>=\s*(\d+)/.exec(engines)?.[1]??0),max=Number(/<\s*(\d+)/.exec(engines)?.[1]??1e9);
 const ok=major>=min&&major<max;
 return ok?passed('node','Node version matches package.json engines',t()-t0,{detail:`${process.version} satisfies "${engines}"`})
  :failed('node','Node version matches package.json engines',`${process.version} does not satisfy "${engines}"`,'Use the pinned toolchain Node (C:\\NIPT-CBH\\toolchain\\node on the server) so native modules (argon2) match the runtime.');
}

/** Installed dependencies equal the pinned versions of package.json (exact pins) and the lockfile names the same roots. */
export function checkDependencies(){
 const t0=t();const pkg=readJson(path.join(repoRoot,'package.json'));
 if(!existsSync(path.join(repoRoot,'node_modules')))return blocked('dependencies','Installed dependencies match package.json / lockfile','node_modules is missing','Run: npm ci');
 const wanted={...pkg.dependencies,...pkg.devDependencies};
 const wrong=[];
 for(const [name,version] of Object.entries(wanted)){
  const f=path.join(repoRoot,'node_modules',...name.split('/'),'package.json');
  if(!existsSync(f)){wrong.push(`${name}: not installed`);continue;}
  const have=readJson(f).version;if(have!==version)wrong.push(`${name}: installed ${have}, package.json pins ${version}`);
 }
 const lock=existsSync(path.join(repoRoot,'package-lock.json'))?readJson(path.join(repoRoot,'package-lock.json')):null;
 if(!lock)return failed('dependencies','Installed dependencies match package.json / lockfile','package-lock.json is missing','Restore package-lock.json from Git.');
 const root={...lock.packages?.['']?.dependencies,...lock.packages?.['']?.devDependencies};
 for(const [name,version] of Object.entries(wanted))if(root[name]!==version)wrong.push(`${name}: lockfile root says ${root[name]??'(absent)'}, package.json pins ${version}`);
 return wrong.length?failed('dependencies','Installed dependencies match package.json / lockfile',wrong.slice(0,8).join('; ')+(wrong.length>8?` … +${wrong.length-8}`:''),'Run: npm ci   (installs exactly the lockfile)')
  :passed('dependencies','Installed dependencies match package.json / lockfile',t()-t0,{detail:`${Object.keys(wanted).length} packages verified`});
}

export function checkCleanRevision({allowDirty=false}={}){
 const t0=t();const status=git(['status','--porcelain','--untracked-files=normal']).split('\n').filter(Boolean);
 const commit=git(['rev-parse','HEAD']);
 if(status.length&&!allowDirty)return failed('git-clean','Clean, exact Git revision',`${status.length} uncommitted/untracked file(s): ${status.slice(0,5).join(', ')}${status.length>5?' …':''}`,'Commit or stash them. Release packages are built from one exact commit only (the installer refuses a dirty tree).',{commit});
 return passed('git-clean','Clean, exact Git revision',t()-t0,{detail:`${commit.slice(0,12)}${status.length?` (WITH ${status.length} uncommitted file(s) — allowed for this run only)`:''}`,commit});
}

export async function checkMigrationInventory(){
 const t0=t();
 try{
  const {migrationInventory}=await import(pathToFileURL(path.join(repoRoot,'deploy','scripts','release-contract.mjs')).href);
  const inv=await migrationInventory(path.join(repoRoot,'db','migrations'));
  const names=Object.keys(inv.files);const nums=names.map(n=>Number(n.match(/^\d+/)[0]));
  const ordered=nums.every((n,i)=>i===0||n>nums[i-1]);
  if(!ordered)return failed('migration-inventory','Migration inventory (ordering, checksums)','migration numbers are not strictly increasing','Renumber the newest migration above the highest applied one.');
  return passed('migration-inventory','Migration inventory (ordering, checksums)',t()-t0,{detail:`${names.length} migrations, inventory sha256 ${inv.sha256.slice(0,16)}…`,migrationsSha256:inv.sha256,count:names.length});
 }catch(e){return failed('migration-inventory','Migration inventory (ordering, checksums)',e.message,'Fix db/migrations.');}
}

/** Where the approved clinical inputs live on this machine: explicit environment variables, else the Staging deployment definition (read only). */
export function assetLocations(){
 let cfg={};
 const dir=process.env.NIPT_DEPLOY_ENV_DIR??'C:\\NIPT-CBH\\deploy\\environments';
 try{const f=path.join(dir,'staging.json');if(existsSync(f))cfg=readJson(f);}catch{/* variables only */}
 return {master:process.env.NIPT_MASTER_WORKBOOK??cfg.masterWorkbook,request:process.env.NIPT_ANC_REQUEST_PDF??cfg.ancRequestPdf,consent:process.env.NIPT_ANC_CONSENT_PDF??cfg.ancConsentPdf};
}
export async function checkAssets(){
 const t0=t();const loc=assetLocations();
 const forms=await import(pathToFileURL(path.join(repoRoot,'tools','win-installer','form-assets.mjs')).href);
 const pins={master:readJson(path.join(repoRoot,'packages','workbook','master-manifest.json')).sha256,request:forms.FORM_ASSETS.request,consent:forms.FORM_ASSETS.consent};
 const missing=[],wrong=[];
 for(const k of ['master','request','consent']){
  if(!loc[k]||!existsSync(loc[k])){missing.push(`${k}${loc[k]?` (${loc[k]})`:''}`);continue;}
  if(sha256File(loc[k])!==pins[k])wrong.push(`${k}: ${loc[k]} does not match the pinned SHA-256 ${pins[k].slice(0,12)}…`);
 }
 if(wrong.length)return failed('assets','Approved master workbook and ANC form originals (pinned SHA-256)',wrong.join('; '),'Use the owner-approved originals; never edit a pin to match a different file.');
 if(missing.length)return blocked('assets','Approved master workbook and ANC form originals (pinned SHA-256)','not found on this machine: '+missing.join(', '),'Set NIPT_MASTER_WORKBOOK / NIPT_ANC_REQUEST_PDF / NIPT_ANC_CONSENT_PDF, or run on the build server where the deployment environment definitions exist.');
 return passed('assets','Approved master workbook and ANC form originals (pinned SHA-256)',t()-t0,{detail:'all 3 match their pins'});
}

export async function checkEnvironmentIdentity(){
 const t0=t();const dir=process.env.NIPT_DEPLOY_ENV_DIR??'C:\\NIPT-CBH\\deploy\\environments';
 const s=path.join(dir,'staging.json'),p=path.join(dir,'production.json');
 if(!existsSync(s)||!existsSync(p))return blocked('environments','Staging / Production definitions are distinct (roots, ports, keys, accounts)',`definitions not found in ${dir}`,'Run on the deployment server, or set NIPT_DEPLOY_ENV_DIR.');
 try{
  const gates=await import(pathToFileURL(path.join(repoRoot,'deploy','windows','deploy-gates.mjs')).href);
  gates.validateEnvironmentPair(readJson(s),readJson(p));
  return passed('environments','Staging / Production definitions are distinct (roots, ports, keys, accounts)',t()-t0,{detail:'validateEnvironmentPair passed (read only)'});
 }catch(e){return failed('environments','Staging / Production definitions are distinct (roots, ports, keys, accounts)',e.message,'Fix the environment definition named by the code; never share a root, port, key or account.');}
}

/** The Ed25519 signing key of the target environment exists (its content is never read here). */
export function checkSigningPrerequisite(environment='staging'){
 const dir=process.env.NIPT_DEPLOY_ENV_DIR??'C:\\NIPT-CBH\\deploy\\environments';const f=path.join(dir,environment+'.json');
 if(!existsSync(f))return blocked('signing','Package-signing prerequisites',`${environment} definition not found`,'Run on the deployment server (needs the environment definition and its Ed25519 key).');
 const cfg=readJson(f);
 if(!cfg.signingKey||!existsSync(cfg.signingKey))return blocked('signing','Package-signing prerequisites',`signing key ${cfg.signingKey??'(none)'} not found`,'deploy-staging.ps1 creates the Staging key on first use (Initialize-NiptSigningKey).');
 const pub=cfg.signingKey.replace(/private/,'public');
 return existsSync(pub)?passed('signing','Package-signing prerequisites',0,{detail:`${environment}: Ed25519 key pair present (private key not read)`})
  :failed('signing','Package-signing prerequisites',`public key ${pub} missing`,'Recreate the public key from the private key with the installer tools; do not copy a key between environments.');
}

export function checkResources({minDiskGb=15,minFreeMemGb=1.5,where=repoRoot}={}){
 const t0=t();const problems=[];
 try{const s=statfsSync(where);const free=s.bavail*s.bsize/2**30;if(free<minDiskGb)problems.push(`${free.toFixed(1)} GB free on ${path.parse(where).root}, need ${minDiskGb} GB for build + package`);}
 catch(e){return blocked('resources','Disk and memory for build and package',`cannot read disk space: ${e.message}`);}
 const mem=os.freemem()/2**30;if(mem<minFreeMemGb)problems.push(`${mem.toFixed(1)} GB free memory, need ${minFreeMemGb} GB (next build is memory hungry; hospital services share this host)`);
 return problems.length?failed('resources','Disk and memory for build and package',problems.join('; '),'Free disk (old build worktrees under C:\\NIPT-CBH\\source\\builds, .local/p8-win/packages) or stop other work, then retry.')
  :passed('resources','Disk and memory for build and package',t()-t0,{detail:`disk and ${mem.toFixed(1)} GB free memory are sufficient`});
}

export function checkWorkingTreeHasNoHospitalData(){
 // safety net: nothing under the repository that looks like real patient material may be tracked (the source guard enforces the rest in CI)
 const t0=t();const tracked=git(['ls-files']).split('\n').filter(f=>/\.(pet|res|ok|zip|bak|dump)$/i.test(f)||/^(data|backups|bundles)\//.test(f));
 return tracked.length?failed('no-hospital-data','No HIS/patient artefacts tracked in Git',tracked.slice(0,5).join(', '),'Remove them from the index; they must never enter the repository.')
  :passed('no-hospital-data','No HIS/patient artefacts tracked in Git',t()-t0);
}


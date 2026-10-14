import {execFileSync} from "node:child_process";
import {generateKeyPairSync} from "node:crypto";
import {mkdir,cp,readFile,writeFile,lstat} from "node:fs/promises";
import path from "node:path";
import {directoryHashes,signManifest,type BundleManifest} from "../packages/operations/bundle";
import {migrationInventory,assertImageProvenance,createFreshBundleDirectory} from "../deploy/scripts/release-contract.mjs";
const git=(...args:string[])=>execFileSync("git",args,{encoding:"utf8"}).trim();
if(git("status","--porcelain","--untracked-files=normal"))throw Error("CLEAN_COMMITTED_SOURCE_REQUIRED");
const revision=git("rev-parse","HEAD"),migration=await migrationInventory("db/migrations");
const imageTag=process.env.NIPT_IMAGE_TAG??"0.1.0";if(!/^(?:0\.1\.0|p8-[a-z0-9][a-z0-9.-]{0,80})$/.test(imageTag))throw Error("RELEASE_IMAGE_TAG_INVALID");
const destination=path.resolve(process.argv[2]??`bundles/nipt-cbh-${imageTag}`);if(!destination.startsWith(path.resolve("bundles")+path.sep))throw Error("BUNDLE_MUST_BE_IN_LOCAL_BUNDLES");
try{await lstat(destination);throw Error("FRESH_BUNDLE_DESTINATION_REQUIRED");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
const imageRoles={web:`nipt-cbh-web:${imageTag}`,operations:`nipt-cbh-operations:${imageTag}`,renderer:`nipt-cbh-renderer:${imageTag}`,postgres:"postgres:17-bookworm",caddy:"caddy:2-alpine"};
const images:Record<string,string>={},provenance={revision,migrationsSha256:migration.sha256};
for(const [role,tag] of Object.entries(imageRoles)){
 const baseReferences:Record<string,string>={postgres:"postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826",caddy:"caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f"};
 const [image]=JSON.parse(execFileSync("docker",["image","inspect",baseReferences[role]??tag],{encoding:"utf8"}));
 if(!/^sha256:[a-f0-9]{64}$/.test(image?.Id??""))throw Error("IMAGE_ID_INVALID");
 assertImageProvenance(image,role,{provenance});images[tag]=image.Id;
 if(["web","operations","renderer"].includes(role)){
  const script="const fs=require('node:fs');const p=JSON.parse(fs.readFileSync('/app/build-provenance.json'));if(fs.existsSync('/app/db/migrations')){const c=require('node:crypto');const f={};for(const n of fs.readdirSync('/app/db/migrations').filter(n=>/^\\d+.*\\.sql$/.test(n)).sort())f[n]=c.createHash('sha256').update(fs.readFileSync('/app/db/migrations/'+n)).digest('hex');if(JSON.stringify(f)!==JSON.stringify(p.migrations))throw Error('BAKED_MIGRATIONS_CHANGED');}console.log(JSON.stringify(p));";
  const baked=JSON.parse(execFileSync("docker",["run","--rm","--network","none","--entrypoint","node",image.Id,"-e",script],{encoding:"utf8"}));
  if(baked.revision!==revision||baked.migrationsSha256!==migration.sha256||JSON.stringify(baked.migrations)!==JSON.stringify(migration.files))throw Error("BAKED_SOURCE_OR_MIGRATION_MISMATCH");
 }
}
await createFreshBundleDirectory(destination,path.resolve("bundles"));await mkdir(path.join(destination,"images"));await mkdir(path.join(destination,"sbom"));
for(const [role,tag] of Object.entries(imageRoles))execFileSync("docker",["save","--output",path.join(destination,"images",`${role}.tar`),images[tag]],{stdio:"inherit"});
// Docker save/load does not preserve registry RepoDigests. Pin every offline service to its
// immutable local image ID, including postgres/caddy; never rely on a warm registry cache.
const logical:Record<string,string>={"nipt-cbh-web:0.1.0":imageRoles.web,"nipt-cbh-operations:0.1.0":imageRoles.operations,"nipt-cbh-renderer:0.1.0":imageRoles.renderer,"postgres:17-bookworm":imageRoles.postgres,"caddy:2-alpine":imageRoles.caddy};
const compose=(await readFile("compose.yaml","utf8")).replace(/^(\s*image: )([^\s]+)$/gm,(_line,prefix:string,reference:string)=>{const tag=logical[reference.split("@")[0]];if(!images[tag])throw Error("UNBUNDLED_IMAGE");return prefix+images[tag];});
await writeFile(path.join(destination,"compose.yaml"),compose);await cp("deploy",path.join(destination,"deploy"),{recursive:true});await cp("db/migrations",path.join(destination,"migrations"),{recursive:true});await cp("docs",path.join(destination,"docs"),{recursive:true});
const sbom=execFileSync(process.platform==="win32"?"npm.cmd":"npm",["sbom","--omit=dev","--sbom-format=cyclonedx"],{encoding:"utf8",shell:process.platform==="win32",maxBuffer:10*1024*1024});await writeFile(path.join(destination,"sbom","cyclonedx.json"),sbom);
await mkdir("data/keys",{recursive:true});let privateKey:string;try{privateKey=await readFile("data/keys/release-private.pem","utf8");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;const keys=generateKeyPairSync("ed25519",{privateKeyEncoding:{type:"pkcs8",format:"pem"},publicKeyEncoding:{type:"spki",format:"pem"}});privateKey=keys.privateKey;await writeFile("data/keys/release-private.pem",privateKey,{mode:0o600,flag:"wx"});await writeFile("data/keys/release-public.pem",keys.publicKey,{flag:"wx"});}
if(git("rev-parse","HEAD")!==revision||git("status","--porcelain","--untracked-files=normal")||(await migrationInventory("db/migrations")).sha256!==migration.sha256)throw Error("SOURCE_CHANGED_DURING_BUNDLE");
const manifest:BundleManifest={version:"0.1.0",syntheticOnly:true,images,imageRoles,provenance,files:await directoryHashes(destination)};await writeFile(path.join(destination,"manifest.json"),JSON.stringify(manifest));await writeFile(path.join(destination,"manifest.sig"),signManifest(manifest,privateKey));process.stdout.write("Signed synthetic offline bundle prepared outside Git. Trusted public key must be transferred independently.\n");

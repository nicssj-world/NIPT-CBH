import {execFileSync} from "node:child_process";
import {generateKeyPairSync} from "node:crypto";
import {mkdir,cp,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {directoryHashes,signManifest,type BundleManifest} from "../packages/operations/bundle";
const destination=path.resolve(process.argv[2]??"bundles/nipt-cbh-0.1.0");if(!destination.startsWith(path.resolve("bundles")+path.sep))throw Error("BUNDLE_MUST_BE_IN_LOCAL_BUNDLES");await mkdir(destination,{recursive:true});await mkdir(path.join(destination,"images"),{recursive:true});await mkdir(path.join(destination,"sbom"),{recursive:true});
const tags=["nipt-cbh-web:0.1.0","nipt-cbh-operations:0.1.0","nipt-cbh-renderer:0.1.0","postgres:17-bookworm","caddy:2-alpine"],images:Record<string,string>={};
for(const tag of tags){images[tag]=execFileSync("docker",["image","inspect",tag,"--format","{{.Id}}"],{encoding:"utf8"}).trim();execFileSync("docker",["save","--output",path.join(destination,"images",tag.replaceAll(/[/:]/g,"_")+".tar"),tag],{stdio:"inherit"});}
// Docker save/load does not preserve registry RepoDigests. Pin every offline service to its
// immutable local image ID, including postgres/caddy; never rely on a warm registry cache.
const compose=(await readFile("compose.yaml","utf8")).replace(/^(\s*image: )([^\s]+)$/gm,(_line,prefix:string,reference:string)=>{const tag=reference.split("@")[0];if(!images[tag])throw Error("UNBUNDLED_IMAGE");return prefix+images[tag];});
await writeFile(path.join(destination,"compose.yaml"),compose);await cp("deploy",path.join(destination,"deploy"),{recursive:true});await cp("db/migrations",path.join(destination,"migrations"),{recursive:true});await cp("docs",path.join(destination,"docs"),{recursive:true});
const sbom=execFileSync(process.platform==="win32"?"npm.cmd":"npm",["sbom","--omit=dev","--sbom-format=cyclonedx"],{encoding:"utf8",shell:process.platform==="win32",maxBuffer:10*1024*1024});await writeFile(path.join(destination,"sbom","cyclonedx.json"),sbom);
await mkdir("data/keys",{recursive:true});let privateKey:string;try{privateKey=await readFile("data/keys/release-private.pem","utf8");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;const keys=generateKeyPairSync("ed25519",{privateKeyEncoding:{type:"pkcs8",format:"pem"},publicKeyEncoding:{type:"spki",format:"pem"}});privateKey=keys.privateKey;await writeFile("data/keys/release-private.pem",privateKey,{mode:0o600,flag:"wx"});await writeFile("data/keys/release-public.pem",keys.publicKey,{flag:"wx"});}
const manifest:BundleManifest={version:"0.1.0",syntheticOnly:true,images,files:await directoryHashes(destination)};await writeFile(path.join(destination,"manifest.json"),JSON.stringify(manifest));await writeFile(path.join(destination,"manifest.sig"),signManifest(manifest,privateKey));process.stdout.write("Signed synthetic offline bundle prepared outside Git. Trusted public key must be transferred independently.\n");

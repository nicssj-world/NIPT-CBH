import {generateKeyPairSync,randomBytes} from "node:crypto";
import {mkdir,writeFile,access,readFile} from "node:fs/promises";
import path from "node:path";
const root=path.resolve("data/keys");await mkdir(root,{recursive:true});
const publicFile=path.join(root,"integration-public.pem"),privateFile=path.join(root,"integration-private.pem");
async function exists(file:string){try{await access(file);return true;}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return false;throw e;}}
const hasPublic=await exists(publicFile),hasPrivate=await exists(privateFile);
if(hasPublic!==hasPrivate)throw Error("INCOMPLETE_INTEGRATION_KEY_PAIR_RESTORE_MATCHING_PAIR");
async function once(file:string,value:string|Buffer){try{await writeFile(file,value,{flag:"wx",mode:0o600});}catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;}}
if(!hasPublic){const pair=generateKeyPairSync("rsa",{modulusLength:3072,publicKeyEncoding:{type:"spki",format:"pem"},privateKeyEncoding:{type:"pkcs8",format:"pem"}});await once(privateFile,pair.privateKey);await once(publicFile,pair.publicKey);}
for(const name of ["identity","lookup","backup"])await once(path.join(root,`${name}.key`),randomBytes(32));
await once(path.join(root,"renderer-token"),randomBytes(32).toString("base64url"));
await mkdir("data/secrets",{recursive:true});
for(const name of ["db-password","web-password","worker-password","seed-password"])await once(`data/secrets/${name}`,randomBytes(24).toString("base64url"));
for(const [role,file] of [["migrator","db"],["web","web"],["worker","worker"]]){const password=(await readFile(`data/secrets/${file}-password`,"utf8")).trim();await once(`data/secrets/${role==="migrator"?"migration":role}-url`,`postgresql://nipt_${role}:${password}@db:5432/nipt_synthetic_compose`);}
await once(".env.local",`NIPT_MODE=synthetic\nDATABASE_URL=postgresql://nipt_dev@127.0.0.1:55432/nipt_synthetic_p1\nAPP_ORIGIN=http://127.0.0.1:3000\nFILE_STORE_ROOT=./data/files\nSIMULATOR_ROOT=./data/simulator\nRENDERER_URL=http://127.0.0.1:3001\nRENDERER_TOKEN_FILE=./data/keys/renderer-token\nINTEGRATION_PUBLIC_KEY_FILE=./data/keys/integration-public.pem\nINTEGRATION_PRIVATE_KEY_FILE=./data/keys/integration-private.pem\nIDENTITY_ENCRYPTION_KEY_FILE=./data/keys/identity.key\nIDENTITY_LOOKUP_KEY_FILE=./data/keys/lookup.key\nBACKUP_KEY_FILE=./data/keys/backup.key\nSYNTHETIC_SEED_PASSWORD_FILE=./data/secrets/seed-password\n`);
process.stdout.write("Synthetic development key/config files prepared outside Git. Existing files preserved.\n");

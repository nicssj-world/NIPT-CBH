import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import path from "node:path";
import {confined} from "../storage";
export type MountRevision={version:number;root:string;mode:"SIMULATOR_READ_ONLY"};
export class SyntheticMountAgent {
 constructor(private readonly stateDirectory:string){}
 async test(candidate:MountRevision):Promise<boolean>{try{if(candidate.mode!=="SIMULATOR_READ_ONLY"||!Number.isInteger(candidate.version)||candidate.version<1)return false;const marker=await readFile(await confined(candidate.root,".nipt-synthetic-root"),"utf8");if(marker!=="NIPT_SYNTHETIC_ONLY_V1")return false;await confined(candidate.root,"inbound");return true;}catch{return false;}}
 async activate(candidate:MountRevision){if(!await this.test(candidate))throw Error("MOUNT_TEST_FAILED_LAST_GOOD_PRESERVED");await mkdir(this.stateDirectory,{recursive:true});const active=path.join(this.stateDirectory,"active.json"),temporary=path.join(this.stateDirectory,"candidate.json");try{const old=await readFile(active);await writeFile(path.join(this.stateDirectory,"last-good.json"),old);}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}await writeFile(temporary,JSON.stringify(candidate),{mode:0o600});await rename(temporary,active);}
 async read():Promise<MountRevision|null>{try{return JSON.parse(await readFile(path.join(this.stateDirectory,"active.json"),"utf8"));}catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}}
}
export function realMountProhibited():never{throw Error("P1_REAL_CIFS_MOUNT_PROHIBITED_AL3_REQUIRED");}

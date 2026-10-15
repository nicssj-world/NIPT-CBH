export type CipherEntry={bytes:number;sha256:string;cipherSha256:string;iv:string;tag:string};
export function encryptFile(source:string,destination:string,key:Buffer,aad:string):Promise<CipherEntry>;
export function decryptFile(source:string,destination:string,key:Buffer,aad:string,entry:CipherEntry):Promise<void>;
export function validatePolicyTarget(policy:unknown,identity:string,database:string,target:string,kind:string):boolean;
export function operationalBackup(output:string,env?:NodeJS.ProcessEnv):Promise<{backupBase:string;format:string;fileCount:number;createdAt:string;manifestSha256:string}>;
export function operationalRestore(base:string,destination:string,env?:NodeJS.ProcessEnv):Promise<Record<string,unknown>>;
export function activateRestored(destination:string,env?:NodeJS.ProcessEnv):Promise<Record<string,unknown>>;

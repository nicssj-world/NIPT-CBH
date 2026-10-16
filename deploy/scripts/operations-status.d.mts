export type OperationEvent={at:string;manifestSha256:string;verification:'CREATION_VERIFIED'|'RESTORE_VERIFIED'};
export type OperationsStatus={format:string;sourceFingerprint:string;generatedAt:string;backup:OperationEvent|null;restore:OperationEvent|null};
export function databaseFingerprint(raw:string):string;
export function verifyOperationsStatus(envelope:unknown,key:string|Buffer,fingerprint:string,now?:Date):OperationsStatus;
export function readOperationsStatus(file:string,keyFile:string,fingerprint:string):Promise<OperationsStatus>;
export function publishOperationsStatus(kind:string,result:Record<string,unknown>,env?:Partial<NodeJS.ProcessEnv>):Promise<{status:string}>;

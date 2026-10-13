export const roles:string[];
export function createFreshBundleDirectory(destination:string,base:string):Promise<void>;
export function migrationInventory(directory:string):Promise<{files:Record<string,string>;sha256:string}>;
export function imageContract(manifest:unknown):Record<string,string>;
export function assertImageProvenance(image:unknown,role:string,manifest:unknown):void;

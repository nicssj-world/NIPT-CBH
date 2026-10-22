export function sha(bytes:Uint8Array|string):string;
export function sourceHash(bytes:Buffer,name:string):string;
export function sourceInventory(root:string):Promise<{algorithm:string;files:Record<string,string>;rawFiles:Record<string,string>;sha256:string}>;

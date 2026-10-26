export function payloadScan(dir:string):Promise<{files:number;violations:{kind:string;path:string}[];testAccountCode:string[]}>;

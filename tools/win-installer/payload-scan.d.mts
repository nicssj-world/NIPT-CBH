export function payloadScan(dir:string,options?:{appOnly?:boolean}):Promise<{files:number;violations:{kind:string;path:string}[];testAccountCode:string[]}>;

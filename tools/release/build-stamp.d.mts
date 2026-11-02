export const STAMP_FORMAT:string;
export function lockfileSha256(root:string):string;
export function inputsDigest(root:string,options?:{nodeVersion?:string}):{digest:string;parts:Record<string,string>};
export function writeBuildStamp(root:string,revision:string):{format:string;revision:string;buildId:string;serverSha256:string|null};
export function verifyBuildStamp(root:string,revision:string):{ok:true;stamp:{buildId:string;revision:string}}|{ok:false;code:string;detail:string};
export function cacheKey(root:string,options?:{nextVersion?:string}):string;
export function restoreBuildCache(root:string,cacheRoot?:string):{restored:boolean;key?:string;reason?:string};
export function saveBuildCache(root:string,cacheRoot?:string):{saved:boolean;key?:string;reason?:string};

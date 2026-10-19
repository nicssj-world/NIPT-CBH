export function thaiCheck(c:{id:string;detail?:string}):string;
export function thaiError(code:string,detail?:unknown):string;
export function thaiStep(line:string):{percent:number;text:string}|null;
export const THAI_WARNING:Record<string,string>;
export function thaiLanWarnings(lan:Record<string,any>|undefined,o?:{admin?:boolean;networkCategory?:string}):string[]; // eslint-disable-line @typescript-eslint/no-explicit-any

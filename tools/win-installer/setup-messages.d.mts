export function thaiCheck(c:{id:string;detail?:string}):string;
export function thaiError(code:string,detail?:unknown):string;
export function thaiStep(line:string):{percent:number;text:string;index:number}|null;
export const THAI_WARNING:Record<string,string>;
export function thaiLanWarnings(lan:Record<string,any>|undefined,o?:{admin?:boolean;networkCategory?:string}):string[]; // eslint-disable-line @typescript-eslint/no-explicit-any
export const STEP_TEXTS:string[];
export function stepIndex(text:string):number;
export function warningKey(text:string):string;
export function pascalTables():string;
export function errorKey(code:string,detail?:unknown):string;

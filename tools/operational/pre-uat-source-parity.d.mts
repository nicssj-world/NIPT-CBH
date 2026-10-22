export type Difference={file:string;primary:string|null;snapshot:string|null;status:string};
export function compareFiles(primary:Record<string,string>,snapshot:Record<string,string>):Difference[];
export function audit(options:{repo:string;snapshot:string;phase?:string;evidence?:string;output?:string}):Promise<{
 status:string;readyForOwnerTest:boolean;features:{id:string;status:string}[];uncommitted:{file:string;status:string}[];differences:Difference[];failures:string[];[key:string]:unknown;
}>;

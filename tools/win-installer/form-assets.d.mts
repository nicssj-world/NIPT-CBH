export const FORM_ASSETS:{id:string;layout:string;dccStatus:string;request:string;consent:string};
export function bundledFormRegistry():{version:number;sets:{id:string;label:string;layout:string;dccStatus:string;request:{path:string;sha256:string;docCode:string;page:string};consent:{path:string;sha256:string;docCode:string;page:string}}[]};
export function stageFormAssets(release:string,inputs:{request?:string;consent?:string}):Promise<string|null>;
export function verifyReleaseFormAssets(release:string,required?:boolean):string|null;
export function releaseFormEnvironment(release:string):{NIPT_ANC_FORM_REGISTRY:string};

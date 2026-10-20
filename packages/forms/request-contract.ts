/** Version the three corrected DCC questions; old answers retain their original meaning. */
export const DCC_REQUEST_CONTRACT='BM17-2026-10-v1' as const;
export function entitlementKind(value:string|null|undefined):'NHSO'|'SELF_PAY'|null {
 if(!value?.trim())return null;
 if(/สปสช|NHSO|\bUC\b/i.test(value))return 'NHSO';
 return /เรียกเก็บ|ชำระเอง|SELF[_ -]?PAY/i.test(value)?'SELF_PAY':null;
}
/** Thai national-ID check digit; this checks the digits only, never identity. */
export function validThaiCitizenId(value:string|null|undefined):boolean {
 if(!value||!/^\d{13}$/.test(value))return false;
 const sum=[...value.slice(0,12)].reduce((total,digit,index)=>total+Number(digit)*(13-index),0);
 return (11-sum%11)%10===Number(value[12]);
}
export function dccRequiredIssues(d:{documentContractVersion?:string;patient:{dob:string|null;entitlement?:string|null;identifier?:string|null;identifierType?:string|null};ordering:{facility:string|null;reason:string|null}}):string[]{
 const issues:string[]=[];
 if(d.documentContractVersion!==DCC_REQUEST_CONTRACT)issues.push('history.documentContractVersion');
 if(!entitlementKind(d.patient.entitlement))issues.push('patient.entitlement');
 if(!d.ordering.facility?.trim())issues.push('ordering.facility');
 if(!validThaiCitizenId(d.patient.identifier))issues.push('patient.identifier');
 if(d.patient.identifierType!=='ThaiNationalId')issues.push('patient.identifier');
 return issues;
}

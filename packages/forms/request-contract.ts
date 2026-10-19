/** Version the three corrected DCC questions; old answers retain their original meaning. */
export const DCC_REQUEST_CONTRACT='BM17-2026-10-v1' as const;
export function entitlementKind(value:string|null|undefined):'NHSO'|'SELF_PAY'|null {
 if(!value?.trim())return null;
 if(/สปสช|NHSO|\bUC\b/i.test(value))return 'NHSO';
 return /เรียกเก็บ|ชำระเอง|SELF[_ -]?PAY/i.test(value)?'SELF_PAY':null;
}
export function dccRequiredIssues(d:{documentContractVersion?:string;patient:{dob:string|null;entitlement?:string|null;identifier?:string|null;identifierType?:string|null};ordering:{facility:string|null;reason:string|null}}):string[]{
 const issues:string[]=[];
 if(d.documentContractVersion!==DCC_REQUEST_CONTRACT)issues.push('history.documentContractVersion');
 if(!d.patient.dob)issues.push('patient.dob');
 if(!entitlementKind(d.patient.entitlement))issues.push('patient.entitlement');
 for(const key of ['facility','reason'] as const)if(!d.ordering[key]?.trim())issues.push('ordering.'+key);
 if(d.patient.identifierType==='ThaiNationalId'&&!/^\d{13}$/.test(d.patient.identifier??''))issues.push('patient.identifier');
 return issues;
}

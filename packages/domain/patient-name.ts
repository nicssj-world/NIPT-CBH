/** HIS patient name: surname^^prefix firstname. Plain ANC names retain their entered form. */
export function patientDisplayName(value:string){const parts=value.split('^');return parts.length>1?`${parts.slice(1).filter(Boolean).join(' ')} ${parts[0]}`.trim():value;}

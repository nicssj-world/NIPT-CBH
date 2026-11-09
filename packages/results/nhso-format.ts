// ลงผลสปสช.: pure display/copy rules shared by the server read model and the popup. No server imports.

/** 13 digits are shown as 1-2345-67890-12-3; anything else (missing, synthetic, passport) is shown as recorded. */
export function nationalIdDisplay(value:string|null|undefined):string|null{
 const v=value?.trim();if(!v)return null;
 return /^\d{13}$/.test(v)?`${v[0]}-${v.slice(1,5)}-${v.slice(5,10)}-${v.slice(10,12)}-${v[12]}`:v;
}
/** What the copy button puts on the clipboard: the digits only, never the dashes. */
export function nationalIdCopy(value:string|null|undefined):string|null{
 const v=value?.trim();if(!v)return null;
 const digits=v.replace(/[-\s]/g,'');
 return /^\d{13}$/.test(digits)?digits:v;
}
/** A gestational age in days split into the two NHSO boxes (weeks, days). */
export function gaParts(totalDays:number|null|undefined):{weeks:number;days:number}|null{
 return typeof totalDays==='number'&&Number.isInteger(totalDays)&&totalDays>=0?{weeks:Math.floor(totalDays/7),days:totalDays%7}:null;
}

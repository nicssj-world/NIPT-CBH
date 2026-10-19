/** Runtime copy only; never transforms stored patient or document data. */
export function p2Text(operational:boolean,text:string):string{return operational?text.replaceAll("จำลอง", "").replaceAll("สมมติ", ""):text;}
export const identifierOptions=(operational:boolean):readonly (readonly [string,string])[]=>operational?[["ThaiNationalId","เลขประจำตัวประชาชน"],["Passport","หนังสือเดินทาง"],["HospitalId","รหัสผู้ป่วยของโรงพยาบาล"],["Other","อื่น ๆ"],["Unknown","ไม่ทราบ"]]:[["Synthetic","ตัวระบุจำลอง"],["Unknown","ไม่ทราบ"]];

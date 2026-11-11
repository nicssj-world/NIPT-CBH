import {THAI_MONTH_SHORT} from "../../../packages/domain/thai-date";
/** "2026-11" -> "พ.ย. 69" (Buddhist Era, two digits). Plain module: used by server and client components alike. */
export const monthLabel=(m:string)=>`${THAI_MONTH_SHORT[Number(m.slice(5,7))-1]} ${String(Number(m.slice(0,4))+543).slice(2)}`;
/** "2026-11" -> "พ.ย. 2569". */
export const monthLabelLong=(m:string)=>`${THAI_MONTH_SHORT[Number(m.slice(5,7))-1]} ${Number(m.slice(0,4))+543}`;

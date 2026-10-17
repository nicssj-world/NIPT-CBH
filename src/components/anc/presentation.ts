import {fiscalYear} from "../../../packages/anc/model";
/** Cross-year context always follows S1 receipt, including a current S2/Repeat. */
export const isOtherFiscalYear=(s1ReceivedAt:string|null,selectedYear:number)=>s1ReceivedAt!==null&&fiscalYear(s1ReceivedAt)!==selectedYear;

/**
 * Working-day arithmetic for the Lab turnaround time (Owner 2026-11-11): TAT is 8 working days from the day the Lab received the specimen;
 * Saturdays, Sundays and the holidays synced from the hospital's iCal calendar are not counted. A day is a Bangkok calendar day (YYYY-MM-DD).
 * Pure functions only: the holiday set is passed in, so the same rule is used by the Lab overview, the ANC statistics and the tests.
 */
export type HolidaySet=ReadonlySet<string>;
export type TatPolicy={businessDays:number;warnDaysLeft:number};
export type TatState='ok'|'due-soon'|'overdue';
export type Tat={used:number;left:number;state:TatState;due:string};

const DAY=86400000,BANGKOK=7*3600000;
/** Longest span counted (ten years): a bad timestamp can never make a loop run for ever. */
const MAX_SPAN_DAYS=3660;
const ISO_DAY=/^\d{4}-\d{2}-\d{2}$/;

/** The Bangkok calendar day of an instant, or the day itself when a YYYY-MM-DD string is given. */
export function bangkokDay(value:Date|string):string{
 if(typeof value==='string'&&ISO_DAY.test(value))return value;
 const t=new Date(value).getTime();
 if(!Number.isFinite(t))throw Error('INVALID_DATE');
 return new Date(t+BANGKOK).toISOString().slice(0,10);
}
export const addDays=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
export function isBusinessDay(day:string,holidays:HolidaySet){const w=new Date(day+'T00:00:00Z').getUTCDay();return w!==0&&w!==6&&!holidays.has(day);}

/** Working days after the receipt day, up to and including the day of `to`. The receipt day itself is day 0, so a specimen received on
 *  Monday has used 1 working day on Tuesday. Never negative. */
export function businessDaysBetween(from:Date|string,to:Date|string,holidays:HolidaySet):number{
 const a=bangkokDay(from),b=bangkokDay(to);
 if(b<=a)return 0;
 let n=0;
 for(let d=addDays(a,1),i=0;d<=b&&i<MAX_SPAN_DAYS;d=addDays(d,1),i++)if(isBusinessDay(d,holidays))n++;
 return n;
}

/** The day the TAT ends: the `n`-th working day after the receipt day. */
export function dueDay(from:Date|string,n:number,holidays:HolidaySet):string{
 let d=bangkokDay(from);
 for(let left=n,i=0;left>0&&i<MAX_SPAN_DAYS;i++){d=addDays(d,1);if(isBusinessDay(d,holidays))left--;}
 return d;
}

/** Where a specimen stands against the TAT: `left` working days remain until the due day (0 = due today); overdue once the due day has passed. */
export function tatStatus(receivedAt:Date|string,now:Date|string,holidays:HolidaySet,policy:TatPolicy):Tat{
 const used=businessDaysBetween(receivedAt,now,holidays),left=policy.businessDays-used;
 return {used,left,state:left<0?'overdue':left<=policy.warnDaysLeft?'due-soon':'ok',due:dueDay(receivedAt,policy.businessDays,holidays)};
}

/** Median of whole numbers (null when empty); used for "median working days to result". */
export function median(values:readonly number[]):number|null{
 if(!values.length)return null;
 const s=[...values].sort((x,y)=>x-y),m=Math.floor(s.length/2);
 return s.length%2?s[m]:(s[m-1]+s[m])/2;
}

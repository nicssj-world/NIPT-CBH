// Hospital wall-time controls use Asia/Bangkok (UTC+07:00), independent of device timezone.
export const bangkokInput=(iso:unknown)=>iso?new Date(Date.parse(String(iso))+7*60*60*1000).toISOString().slice(0,16):"";
export const bangkokInstant=(wall:string)=>wall?new Date(wall+"+07:00").toISOString():null;

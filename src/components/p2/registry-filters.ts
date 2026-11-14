/**
 * Central registry filters in the URL (Owner 2026-11-14): the Dashboard opens `/cases?status=…&flag=…` and Back returns to the same list.
 * Only filter codes, a unit id, dates and the page live in the URL: never the search text (an LN, HN or name is patient data).
 * The values mirror packages/p2/service.ts (REGISTRY_STATUSES / REGISTRY_FLAGS); anything else in the URL is ignored.
 */
export const STATUSES=["awaiting","testing","released","followup","other"] as const;
export const FLAGS=["high","high_run","ga18","hold","identity","attention","tat_open","tat_due","tat_overdue"] as const;
export const SORTS=["registered","desc","asc","sent_desc","sent_asc"] as const;
export type Status=typeof STATUSES[number];export type Flag=typeof FLAGS[number];export type Sort=typeof SORTS[number];
export type RegistryFilters={status:Status|"";flag:Flag|"";unitId:string;from:string;to:string;sort:Sort;page:number;pageSize:number};
export const DEFAULT_FILTERS:RegistryFilters={status:"",flag:"",unitId:"",from:"",to:"",sort:"registered",page:1,pageSize:25};
const SIZES=[25,50,100];
const ISO=/^\d{4}-\d{2}-\d{2}$/,UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pick=<T extends string>(list:readonly T[],v:string|null|undefined):T|""=>(list as readonly string[]).includes(v??"")?v as T:"";

export function readFilters(params:{get(k:string):string|null}):RegistryFilters{
 const page=Number(params.get("page")),size=Number(params.get("pageSize"));
 const date=(k:string)=>{const v=params.get(k)??"";return ISO.test(v)?v:"";};
 const unit=params.get("unitId")??"";
 return {status:pick(STATUSES,params.get("status")),flag:pick(FLAGS,params.get("flag")),unitId:UUID.test(unit)?unit:"",from:date("from"),to:date("to"),
  sort:pick(SORTS,params.get("sort"))||"registered",page:Number.isInteger(page)&&page>=1&&page<=10000?page:1,pageSize:SIZES.includes(size)?size:DEFAULT_FILTERS.pageSize};
}
/** The URL query for a filter set; defaults are left out so a plain list is `/cases`. `register` / `registration` notices are not kept. */
export function filtersQuery(f:RegistryFilters):string{
 const q=new URLSearchParams();
 for(const k of ["status","flag","unitId","from","to"] as const)if(f[k])q.set(k,f[k]);
 if(f.sort!=="registered")q.set("sort",f.sort);
 if(f.page>1)q.set("page",String(f.page));
 if(f.pageSize!==DEFAULT_FILTERS.pageSize)q.set("pageSize",String(f.pageSize));
 const s=q.toString();return s?"?"+s:"";
}
/** A link to the registry with these filters (Dashboard cards and alerts). */
export const registryHref=(f:Partial<RegistryFilters>)=>"/cases"+filtersQuery({...DEFAULT_FILTERS,...f});
export const hasFilters=(f:RegistryFilters)=>!!(f.status||f.flag||f.unitId||f.from||f.to);

/** Status words: ANC people language, Lab vocabulary (Owner 2026-11-08). */
export const STATUS_LABEL:Record<"anc"|"lab",Record<Status,string>>={
 anc:{awaiting:"รอ Lab รับตัวอย่าง",testing:"กำลังตรวจ",released:"มีผลตรวจแล้ว",followup:"ต้องเจาะเลือดใหม่",other:"ตรวจสอบสถานะ"},
 lab:{awaiting:"ยังไม่รับตัวอย่าง",testing:"รับแล้ว · กำลังตรวจ",released:"ออกผลแล้ว",followup:"รอเจาะเลือดซ้ำ",other:"ตรวจสอบสถานะ"},
};
export const FLAG_LABEL:Record<Flag,string>={high:"High Risk",high_run:"High Risk ชุดผลล่าสุด",ga18:"อายุครรภ์เกิน 18 สัปดาห์",hold:"HOLD",identity:"ข้อมูลไม่ตรงกัน",attention:"ต้องติดตาม",tat_open:"รอผลอยู่",tat_due:"ใกล้ครบกำหนดรอผล",tat_overdue:"รอผลเกินกำหนด"};
export const SORT_LABEL:Record<Sort,string>={registered:"ลงทะเบียนล่าสุดก่อน",desc:"รับสิ่งส่งตรวจ ใหม่ → เก่า",asc:"รับสิ่งส่งตรวจ เก่า → ใหม่",sent_desc:"วันที่ส่งตรวจ ใหม่ → เก่า",sent_asc:"วันที่ส่งตรวจ เก่า → ใหม่"};

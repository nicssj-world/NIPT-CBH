// GA ≥ 22+0 notice (Owner: warning only). The value comes from the server; this never blocks or reorders work.
export type Ga={days:number;weeks:number;remainder:number;warning:boolean;collectionBasis:"HIS_RECEIPT"|"REQUEST"}|null;
export const gaBadge=(ga:Ga)=>ga?.warning?<span className="badge warning" title={`อายุครรภ์ ณ วันเจาะ ${ga.weeks}+${ga.remainder} (${ga.days} วัน) จาก EDD ในใบขอตรวจ และวันเจาะ${ga.collectionBasis==="HIS_RECEIPT"?"จาก HIS":"ในใบขอตรวจ"} — แจ้งเตือนเท่านั้น ไม่บล็อกการทำงาน`}>GA {ga.weeks}+{ga.remainder} (≥22 สัปดาห์)</span>:null;

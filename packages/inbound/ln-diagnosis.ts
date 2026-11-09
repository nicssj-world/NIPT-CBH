import type {Queryable} from '../db/connection';

/**
 * Why a LN has (or has no) PET in the system, from what the scanner itself recorded. It reads only the database (sightings, tombstones,
 * `.ok` waiting list, stored files), never the HIS share, and returns operational facts only: day folder, times, sizes, states.
 * A file the reader classes as "not NIPT" leaves no trace by design, so "never seen" can also mean that.
 */
export type LnDiagnosis={
 ln:string;
 files:{state:string;errorCode:string|null;dayFolder:string|null;pathVersion:number|null}[];
 sightings:{dayFolder:string;byteSize:number;firstSeenAt:Date;lastModifiedAt:Date;stored:boolean}[];
 deleted:{dayFolder:string;deletedAt:Date;released:boolean;superseded:boolean;deletedReason:string|null;probeReason:string|null;probedAt:Date|null}[];
 waiting:{dayFolder:string;firstSeenAt:Date;lastSeenAt:Date;okSeenAt:Date|null}[];
};
const day=(path:string)=>/^inbound\/(\d{8})\//.exec(path)?.[1]??'';
/** What a reader error code means, in words an operator can pass on to the HIS team. */
export const READ_REASON:Record<string,string>={INVALID_FIELDS:'จำนวนฟิลด์หรือโครงสร้างบรรทัดไม่ตรงตามที่กำหนด (P ต้อง 35, O ต้อง 29)',INVALID_ENCODING:'รหัสอักขระไม่ใช่ CP874 ที่ถูกต้อง',INVALID_FILENAME:'ชื่อไฟล์ไม่ตรงรูปแบบ',LN_MISMATCH:'LN ในไฟล์ไม่ตรงกับชื่อไฟล์',INVALID_DATE:'วันที่ในไฟล์ไม่ถูกต้อง',INVALID_PET_COLLECTION_RECEIPT:'เวลาเก็บ/รับตัวอย่างในไฟล์ไม่ถูกต้อง',INVALID_PATIENT_IDENTITY:'ข้อมูลระบุตัวผู้ป่วยไม่ถูกต้อง (HN, ชื่อ, เพศ หรือเลขบัตร)',STRUCTURAL_INJECTION:'พบอักขระต้องห้ามในฟิลด์',INVALID_RECORD_SEPARATOR:'ตัวคั่นบรรทัดไม่ถูกต้อง',NOT_NIPT:'ใบสั่งไม่ใช่ NIPT (ไม่มีรหัสตรวจ 70096)',FILE_TOO_LARGE:'ไฟล์ใหญ่เกินกำหนด',PROCESSING_FAILED:'ระบบอ่านไฟล์ไม่สำเร็จด้วยสาเหตุที่ไม่ระบุ'};

export async function lnDiagnosis(db:Queryable,rawLn:string):Promise<LnDiagnosis|null>{
 const ln=rawLn.replaceAll('-','').trim();
 if(!/^\d{6,20}$/.test(ln))return null;
 const pattern=`^inbound/[0-9]{8}/${ln}-[0-9]+\.pet$`;
 const [files,sightings,deleted,waiting,runs]=await Promise.all([
  db.query<{state:string;error_code:string|null;source_path:string|null;path_version:number|null}>('SELECT state,error_code,source_path,path_version FROM his_inbound_file WHERE ln=$1 ORDER BY discovered_at DESC LIMIT 20',[ln]),
  db.query<{source_path:string;byte_size:number;first_seen_at:Date;source_mtime:Date;inbound_file_id:string|null}>('SELECT source_path,byte_size,first_seen_at,source_mtime,inbound_file_id FROM his_inbound_source WHERE source_path ~ $1 ORDER BY first_seen_at DESC LIMIT 20',[pattern]),
  db.query<{source_path:string;created_at:Date;released:boolean;superseded:boolean;deleted_reason:string|null;probe_reason:string|null;probed_at:Date|null}>(
   `SELECT p.source_path,p.created_at,EXISTS(SELECT 1 FROM his_inbound_file_purge_release r WHERE r.sha256=p.sha256) released,EXISTS(SELECT 1 FROM his_inbound_file_purge_event e WHERE e.sha256=p.sha256) superseded,
     (SELECT a.details->>'reasonCode' FROM audit_chain a WHERE a.action='INBOUND_PARSE_ERROR_DELETED' AND a.resource_id=p.deleted_file_id ORDER BY a.sequence DESC LIMIT 1) deleted_reason,
     NULL::text probe_reason,NULL::timestamptz probed_at
    FROM his_inbound_file_purge p WHERE p.ln=$1 ORDER BY p.created_at DESC LIMIT 20`,[ln]),
  db.query<{source_path:string;first_seen_at:Date;last_seen_at:Date;ok_seen_at:Date|null}>('SELECT source_path,first_seen_at,last_seen_at,ok_seen_at FROM his_inbound_waiting WHERE source_path ~ $1 ORDER BY first_seen_at DESC LIMIT 20',[pattern]),
  // The newest scan that skipped a tombstoned file of this LN records the reader's reason as counter skip_<LN>_<REASON>.
  db.query<{finished_at:Date;reason:string}>(`SELECT r.finished_at,substr(k.key,length($2)+1) reason FROM his_inbound_scan_run r CROSS JOIN LATERAL jsonb_object_keys(r.counts) k(key) WHERE k.key LIKE $1 ORDER BY r.finished_at DESC LIMIT 1`,[`skip\\_${ln}\\_%`,`skip_${ln}_`])
 ]);
 const probe=runs.rows[0]??null;
 return {ln,
  files:files.rows.map(f=>({state:f.state,errorCode:f.error_code,dayFolder:f.source_path?day(f.source_path):null,pathVersion:f.path_version})),
  sightings:sightings.rows.map(s=>({dayFolder:day(s.source_path),byteSize:s.byte_size,firstSeenAt:s.first_seen_at,lastModifiedAt:s.source_mtime,stored:s.inbound_file_id!==null})),
  deleted:deleted.rows.map(d=>({dayFolder:day(d.source_path),deletedAt:d.created_at,released:d.released,superseded:d.superseded,deletedReason:d.deleted_reason,probeReason:probe?.reason??null,probedAt:probe?.finished_at??null})),
  waiting:waiting.rows.map(w=>({dayFolder:day(w.source_path),firstSeenAt:w.first_seen_at,lastSeenAt:w.last_seen_at,okSeenAt:w.ok_seen_at}))};
}

/** One plain-Thai conclusion for the page; the caller shows the raw rows as evidence beside it. */
export function lnVerdict(d:LnDiagnosis):{tone:'good'|'warn'|'bad';text:string}{
 const usable=d.files.filter(f=>f.state!=='ParseError');
 if(usable.length)return {tone:'good',text:'ระบบนำเข้าไฟล์ของ LN นี้แล้ว ใช้ลงทะเบียนได้ (ดูรายการด้านล่าง)'};
 const open=d.deleted.filter(x=>!x.superseded);
 const still=open.find(x=>x.probeReason&&!x.released);
 if(still)return {tone:'bad',text:`ไฟล์ของ LN นี้เคยถูกลบจากรายการอ่านไม่ได้ และตัวอ่านปัจจุบันยังอ่านไฟล์เดิมไม่ผ่าน: ${READ_REASON[still.probeReason!]??still.probeReason} (รหัส ${still.probeReason}) ไฟล์จึงยังไม่ถูกนำเข้า ต้องให้ HIS ส่งไฟล์ที่ถูกต้อง (เนื้อไฟล์ต่างจากเดิม) หรือแจ้งผู้พัฒนาหากเห็นว่าไฟล์ถูกต้อง การลงทะเบียน LN นี้ไม่ถูกบล็อกจากรายการที่ลบ`};
 if(open.length&&!open.some(x=>x.released))return {tone:'warn',text:'ไฟล์ของ LN นี้เคยถูกลบจากรายการอ่านไม่ได้ ระบบยังไม่ได้ตรวจไฟล์เดิมใหม่ ถ้าตัวอ่านปัจจุบันอ่านผ่านจะนำเข้าให้เองในรอบสแกนถัดไป (สั่ง "สแกนย้อนหลัง" ให้ครอบคลุมวันที่ของไฟล์) รายการที่ลบไม่บล็อกการลงทะเบียน'};
 if(open.length)return {tone:'warn',text:'ระบบอนุญาตให้อ่านไฟล์ที่เคยถูกลบนี้ซ้ำแล้ว รอรอบสแกนถัดไปนำเข้า'};
 if(d.files.some(f=>f.state==='ParseError'))return {tone:'bad',text:'ระบบอ่านไฟล์ของ LN นี้ไม่ผ่าน ดูรหัสข้อผิดพลาดในรายการด้านล่าง'};
 if(d.waiting.some(w=>!w.okSeenAt))return {tone:'warn',text:'พบไฟล์ .pet แล้วแต่ยังไม่มีไฟล์ .ok ระบบจะไม่อ่านจนกว่าจะมี .ok'};
 if(d.sightings.length)return {tone:'warn',text:'ระบบเคยเห็นไฟล์ของ LN นี้แต่ไม่มีไฟล์ที่ใช้ได้เก็บไว้ ดูรายการด้านล่าง'};
 return {tone:'bad',text:'ระบบยังไม่เคยเห็นไฟล์ของ LN นี้เลย อาจเป็นเพราะโฟลเดอร์หรือวันที่อยู่นอกช่วงสแกน หรือใบสั่งไม่ใช่ NIPT (ระบบไม่เก็บร่องรอยของไฟล์ที่ไม่ใช่ NIPT) ลองสั่ง "สแกนย้อนหลัง" ให้ครอบคลุมวันที่ของไฟล์ แล้วดูตัวเลข "ไม่ใช่ NIPT" ในสรุป'};
}

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
 deleted:{dayFolder:string;deletedAt:Date;released:boolean;superseded:boolean}[];
 waiting:{dayFolder:string;firstSeenAt:Date;lastSeenAt:Date;okSeenAt:Date|null}[];
};
const day=(path:string)=>/^inbound\/(\d{8})\//.exec(path)?.[1]??'';

export async function lnDiagnosis(db:Queryable,rawLn:string):Promise<LnDiagnosis|null>{
 const ln=rawLn.replaceAll('-','').trim();
 if(!/^\d{6,20}$/.test(ln))return null;
 const pattern=`^inbound/[0-9]{8}/${ln}-[0-9]+\.pet$`;
 const [files,sightings,deleted,waiting]=await Promise.all([
  db.query<{state:string;error_code:string|null;source_path:string|null;path_version:number|null}>('SELECT state,error_code,source_path,path_version FROM his_inbound_file WHERE ln=$1 ORDER BY discovered_at DESC LIMIT 20',[ln]),
  db.query<{source_path:string;byte_size:number;first_seen_at:Date;source_mtime:Date;inbound_file_id:string|null}>('SELECT source_path,byte_size,first_seen_at,source_mtime,inbound_file_id FROM his_inbound_source WHERE source_path ~ $1 ORDER BY first_seen_at DESC LIMIT 20',[pattern]),
  db.query<{source_path:string;created_at:Date;released:boolean;superseded:boolean}>(
   `SELECT p.source_path,p.created_at,EXISTS(SELECT 1 FROM his_inbound_file_purge_release r WHERE r.sha256=p.sha256) released,EXISTS(SELECT 1 FROM his_inbound_file_purge_event e WHERE e.sha256=p.sha256) superseded
    FROM his_inbound_file_purge p WHERE p.ln=$1 ORDER BY p.created_at DESC LIMIT 20`,[ln]),
  db.query<{source_path:string;first_seen_at:Date;last_seen_at:Date;ok_seen_at:Date|null}>('SELECT source_path,first_seen_at,last_seen_at,ok_seen_at FROM his_inbound_waiting WHERE source_path ~ $1 ORDER BY first_seen_at DESC LIMIT 20',[pattern])
 ]);
 return {ln,
  files:files.rows.map(f=>({state:f.state,errorCode:f.error_code,dayFolder:f.source_path?day(f.source_path):null,pathVersion:f.path_version})),
  sightings:sightings.rows.map(s=>({dayFolder:day(s.source_path),byteSize:s.byte_size,firstSeenAt:s.first_seen_at,lastModifiedAt:s.source_mtime,stored:s.inbound_file_id!==null})),
  deleted:deleted.rows.map(d=>({dayFolder:day(d.source_path),deletedAt:d.created_at,released:d.released,superseded:d.superseded})),
  waiting:waiting.rows.map(w=>({dayFolder:day(w.source_path),firstSeenAt:w.first_seen_at,lastSeenAt:w.last_seen_at,okSeenAt:w.ok_seen_at}))};
}

/** One plain-Thai conclusion for the page; the caller shows the raw rows as evidence beside it. */
export function lnVerdict(d:LnDiagnosis):{tone:'good'|'warn'|'bad';text:string}{
 const usable=d.files.filter(f=>f.state!=='ParseError');
 if(usable.length)return {tone:'good',text:'ระบบนำเข้าไฟล์ของ LN นี้แล้ว ใช้ลงทะเบียนได้ (ดูรายการด้านล่าง)'};
 const open=d.deleted.filter(x=>!x.superseded);
 if(open.length&&!open.some(x=>x.released))return {tone:'warn',text:'ระบบเคยอ่านไฟล์ของ LN นี้ไม่ผ่านแล้วมีผู้ลบรายการ ไฟล์เนื้อหาเดิมถูกข้ามและ LN ถูกบล็อก ถ้าเนื้อหานั้นอ่านผ่านด้วยตัวอ่านปัจจุบัน ระบบจะนำเข้าให้เองในรอบสแกนถัดไป'};
 if(open.length)return {tone:'warn',text:'ระบบอนุญาตให้อ่านไฟล์ที่เคยถูกลบนี้ซ้ำแล้ว รอรอบสแกนถัดไปนำเข้า'};
 if(d.files.some(f=>f.state==='ParseError'))return {tone:'bad',text:'ระบบอ่านไฟล์ของ LN นี้ไม่ผ่าน ดูรหัสข้อผิดพลาดในรายการด้านล่าง'};
 if(d.waiting.some(w=>!w.okSeenAt))return {tone:'warn',text:'พบไฟล์ .pet แล้วแต่ยังไม่มีไฟล์ .ok ระบบจะไม่อ่านจนกว่าจะมี .ok'};
 if(d.sightings.length)return {tone:'warn',text:'ระบบเคยเห็นไฟล์ของ LN นี้แต่ไม่มีไฟล์ที่ใช้ได้เก็บไว้ ดูรายการด้านล่าง'};
 return {tone:'bad',text:'ระบบยังไม่เคยเห็นไฟล์ของ LN นี้เลย อาจเป็นเพราะโฟลเดอร์หรือวันที่อยู่นอกช่วงสแกน หรือใบสั่งไม่ใช่ NIPT (ระบบไม่เก็บร่องรอยของไฟล์ที่ไม่ใช่ NIPT) ลองสั่ง "สแกนย้อนหลัง" ให้ครอบคลุมวันที่ของไฟล์ แล้วดูตัวเลข "ไม่ใช่ NIPT" ในสรุป'};
}

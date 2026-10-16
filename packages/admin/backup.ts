import {readOperationsStatus,databaseFingerprint} from '../../deploy/scripts/operations-status.mjs';
export async function backupMonitoring(env:Partial<NodeJS.ProcessEnv>=process.env){
 const empty={lastSuccessfulBackup:null as string|null,backupAgeHours:null as number|null,lastRestoreDrill:null as string|null,integrity:'NOT VERIFIED',status:'NOT CONFIGURED',reason:'Hospital IT ต้องติดตั้ง signed operations receipt และ Public Key; Web ไม่อ่าน Encryption Key',retention:'INSTALLATION-OWNED',warning:true};
 if(!env.NIPT_OPERATIONS_STATUS_FILE||!env.NIPT_OPERATIONS_STATUS_PUBLIC_KEY_FILE)return empty;
 try{const s=await readOperationsStatus(env.NIPT_OPERATIONS_STATUS_FILE,env.NIPT_OPERATIONS_STATUS_PUBLIC_KEY_FILE,databaseFingerprint(env.DATABASE_URL??''));const age=s.backup?Math.max(0,(Date.now()-Date.parse(s.backup.at))/3600000):null;
 const warningHours=Number(env.NIPT_BACKUP_WARNING_HOURS??24);if(!Number.isFinite(warningHours)||warningHours<1)throw Error('BACKUP_WARNING_CONFIG_INVALID');
 return {...empty,status:s.backup?'VERIFIED RECEIPT':'NOT VERIFIED',lastSuccessfulBackup:s.backup?.at??null,backupAgeHours:age,lastRestoreDrill:s.restore?.at??null,integrity:s.restore&&s.restore.manifestSha256===s.backup?.manifestSha256?'RESTORE_VERIFIED':s.backup?'CREATION_VERIFIED (ยังไม่ยืนยัน Restore)':'NOT VERIFIED',warning:age===null||age>warningHours,reason:'Signed receipt จาก Operational Backup/Restore เดิม; Restore verification ไม่ใช่ Hospital RPO/RTO Acceptance'};
 }catch{return {...empty,status:'NOT VERIFIED',reason:'ตรวจลายเซ็น/Target/Receipt ไม่ผ่าน; ไม่ใช้การพบไฟล์เป็นหลักฐานสำเร็จ'};}
}

// Thai messages for the one-click Setup. Pure functions: the Setup wrapper turns engine codes into sentences a hospital administrator can act on;
// the technical detail goes to the log file, never into the dialog. Node built-ins only.

const CHECK={
 windows:'ต้องติดตั้งบน Windows',
 node24:'ไฟล์ติดตั้งเตรียม Node.js ไม่สำเร็จ',
 install_root_safe:'โฟลเดอร์ติดตั้งไม่ถูกต้อง',
 install_root_empty:'โฟลเดอร์ติดตั้งมีไฟล์อื่นอยู่แล้ว หรือมีการติดตั้งอยู่แล้ว',
 free_space_8gb:'พื้นที่ว่างในดิสก์ไม่พอ (ต้องมีอย่างน้อย 8 GB)',
 package_signature_and_files:'ไฟล์ติดตั้งเสียหายหรือถูกแก้ไข จึงไม่ติดตั้งต่อ (ตรวจลายเซ็นไม่ผ่าน) กรุณาคัดลอกไฟล์ติดตั้งใหม่',
 runtime_in_package:'ไฟล์ติดตั้งไม่ครบ (ส่วนประกอบ Node.js/PostgreSQL)',
 master_workbook_sha256:'ไม่พบไฟล์ Master Workbook ที่ถูกต้องในชุดติดตั้ง',
 task_scheduler:'Windows Task Scheduler ใช้งานไม่ได้',
 powershell7_in_package:'ไฟล์ติดตั้งไม่ครบ (PowerShell 7)',
 excel_installed:'ไม่พบ Microsoft Excel',
 word_installed:'ไม่พบ Microsoft Word',
 lan_address:'ไม่พบที่อยู่ IP ของเครื่องนี้ในเครือข่าย LAN (ต้องเสียบสายเครือข่ายและมี Default Gateway)',
 default_printer_current_user:'ยังไม่มีเครื่องพิมพ์เริ่มต้นของผู้ใช้นี้'
};
const ROOT={
 INSTALL_ROOT_MUST_BE_ASCII:'ชื่อโฟลเดอร์ติดตั้งต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือช่องว่างเท่านั้น (PostgreSQL ใช้ชื่อโฟลเดอร์ภาษาไทยไม่ได้) เช่น C:\\NIPT-CBH',
 INSTALL_ROOT_TOO_SHORT:'ชื่อโฟลเดอร์ติดตั้งสั้นเกินไป',
 INSTALL_ROOT_IS_DRIVE_ROOT:'ห้ามติดตั้งที่รากของไดรฟ์ ให้ระบุโฟลเดอร์ เช่น C:\\NIPT-CBH'
};
// Office and printer are reported as warnings, never as a reason to refuse the installation (the system runs; PDF export needs them)
const SOFT_CHECKS=new Set(['excel_installed','word_installed','default_printer_current_user']);
export function thaiCheck(c){
 if(c.id==='install_root_safe'&&ROOT[c.detail])return ROOT[c.detail];
 if(c.id.startsWith('port_'))return `พอร์ต ${c.detail} ถูกโปรแกรมอื่นใช้อยู่ ปิดโปรแกรมนั้นหรือเลือกติดตั้งแบบกำหนดเอง`;
 return CHECK[c.id]??`การตรวจสอบก่อนติดตั้งไม่ผ่าน: ${c.id}`;
}
const CODE={
 ADMINISTRATOR_REQUIRED_FOR_SYSTEM_TASK:'ต้องเปิดตัวติดตั้งด้วยสิทธิ์ผู้ดูแลระบบ (กด Yes ใน UAC) จึงจะตั้งให้ระบบเริ่มทำงานตอนเปิดเครื่องได้',
 INSTALL_USER_IS_NOT_THE_LOGGED_ON_USER:'ผู้ใช้ที่ติดตั้งไม่ใช่ผู้ใช้ที่เข้าสู่ระบบ Windows อยู่ กรุณาเปิดตัวติดตั้งจากบัญชีที่ใช้งานเครื่องนี้ แล้วกด Yes ใน UAC',
 INSTALLED_VERSION_IS_NEWER:'เครื่องนี้ติดตั้งเวอร์ชันที่ใหม่กว่าอยู่แล้ว ระบบไม่ติดตั้งเวอร์ชันเก่าทับ',
 RUNTIME_CHANGE_NOT_SUPPORTED:'เวอร์ชันนี้เปลี่ยนส่วนประกอบหลัก (Node.js/PostgreSQL) จึงอัปเกรดทับไม่ได้ ข้อมูลเดิมยังอยู่ครบ กรุณาติดต่อผู้พัฒนา',
 UPGRADE_VERSION_NOT_NEWER:'เวอร์ชันนี้ไม่ใหม่กว่าที่ติดตั้งอยู่',
 UPGRADE_SCHEMA_INCOMPATIBLE:'ฐานข้อมูลเดิมไม่เข้ากับเวอร์ชันนี้ ระบบไม่เปลี่ยนแปลงอะไร ข้อมูลเดิมยังอยู่ครบ',
 UPGRADE_FAILED_HEALTH:'เวอร์ชันใหม่ไม่ผ่านการตรวจความพร้อม ระบบย้อนกลับไปใช้เวอร์ชันก่อนหน้าและตรวจระบบเดิมแล้ว ข้อมูลเดิมยังอยู่ครบ รายละเอียดอยู่ในไฟล์ Log',
 UPGRADE_FAILED_HEALTH_RESTORE_REQUIRED:'เวอร์ชันใหม่ไม่ผ่านการตรวจความพร้อม และฐานข้อมูลมีโครงสร้างที่เวอร์ชันก่อนหน้าใช้ไม่ได้ ระบบจึงไม่ย้อนกลับและไม่กู้ฐานข้อมูลอัตโนมัติ เวอร์ชันใหม่ยังติดตั้งอยู่ ข้อมูลและข้อมูลสำรองยังอยู่ ห้ามถอนการติดตั้งหรือเปิดเวอร์ชันเก่า ให้ตรวจ Status และไฟล์ Log ก่อนดำเนินการต่อ',
 UPGRADE_FAILED_HEALTH_RECOVERY_REQUIRED:'เวอร์ชันใหม่ไม่ผ่านการตรวจความพร้อม และระบบยืนยันการย้อนกลับไม่สำเร็จ ข้อมูลและข้อมูลสำรองยังอยู่ ห้ามถอนการติดตั้งหรือถือว่าระบบพร้อมใช้ ให้ตรวจ Status และไฟล์ Log ก่อนดำเนินการต่อ',
 UPGRADE_MIGRATION_FAILED_OLD_RELEASE_STILL_RUNNING:'อัปเกรดฐานข้อมูลไม่สำเร็จ ระบบเวอร์ชันเดิมยังทำงานอยู่ตามปกติ ข้อมูลเดิมยังอยู่ครบ',
 UPGRADE_MIGRATION_FAILED_RESTORE_REQUIRED:'อัปเกรดฐานข้อมูลไม่สำเร็จ ต้องกู้คืนจากข้อมูลสำรองก่อนอัปเกรด (ข้อมูลสำรองถูกสร้างไว้แล้ว) กรุณาติดต่อผู้พัฒนา',
 PROVISION_FAILED:'เตรียมฐานข้อมูลไม่สำเร็จ ระบบจะลบสิ่งที่ติดตั้งค้างไว้ให้',
 BACKUP_FAILED:'สร้างข้อมูลสำรองครั้งแรกไม่สำเร็จ',
 LAN_ADDRESS_NOT_FOUND:'ไม่พบที่อยู่ IP ของเครื่องนี้ในเครือข่าย LAN',
 NO_FREE_PORT:'ไม่พบพอร์ตว่างสำหรับระบบ กรุณาปิดโปรแกรมที่ใช้พอร์ตจำนวนมากแล้วลองใหม่',
 ADMIN_IDENTITY_REQUIRED:'ต้องระบุชื่อผู้ใช้และชื่อ-นามสกุลของผู้ดูแลระบบ (APP_ADMIN) ก่อนติดตั้ง ไม่มีบัญชีหรือรหัสผ่านเริ่มต้นที่กำหนดไว้ล่วงหน้า',
 PRODUCTION_ADMIN_IDENTITY_REQUIRED:'ต้องระบุชื่อผู้ใช้และชื่อ-นามสกุลของผู้ดูแลระบบ (APP_ADMIN) ก่อนติดตั้ง ไม่มีบัญชีหรือรหัสผ่านเริ่มต้นที่กำหนดไว้ล่วงหน้า',
 PRODUCTION_ADMIN_USERNAME_INVALID:'ชื่อผู้ใช้ไม่ถูกต้อง ใช้ได้เฉพาะตัวพิมพ์เล็กอังกฤษ ตัวเลข จุด ขีดกลาง ขีดล่าง ความยาว 3-64 ตัวอักษร และห้ามขึ้นต้นด้วย uat. หรือ synthetic.',
 SINGLE_ADMIN_BOOTSTRAP_ONLY:'การติดตั้งสร้างบัญชีแรกเพียงบัญชีเดียว คือผู้ดูแลระบบ (APP_ADMIN) ผู้ใช้อื่นเพิ่มภายหลังในเมนูจัดการผู้ใช้',
 PRODUCTION_PACKAGE_REFUSES_TEST_INPUTS:'ชุดติดตั้งนี้มีส่วนทดสอบปนอยู่ จึงไม่ติดตั้งเป็นระบบใช้งานจริง',
 UPGRADE_BASE_REVISION_MISMATCH:'ตัวอัปเดตนี้สร้างสำหรับเวอร์ชันต้นฉบับเฉพาะ ซึ่งไม่ตรงกับที่ติดตั้งอยู่ในเครื่องนี้ ระบบจึงไม่เปลี่ยนแปลงอะไรเลย กรุณาแจ้งผู้พัฒนาพร้อมหมายเลขเวอร์ชันที่ติดตั้ง (ดูได้จาก Status)',
 UPGRADE_PROFILE_MISMATCH:'ชุดติดตั้งนี้เป็นคนละประเภท (ทดสอบ/ใช้งานจริง) กับระบบที่ติดตั้งอยู่ จึงไม่อัปเกรดทับ',
 PROFILE_PACKAGE_MISMATCH:'ประเภทของชุดติดตั้งไม่ตรงกับที่ร้องขอ',
 PACKAGE_CHECKSUM_MISMATCH:'ไฟล์ติดตั้งเสียหายหรือถูกแก้ไข (ตรวจความสมบูรณ์ไม่ผ่าน) กรุณาคัดลอกไฟล์ติดตั้งใหม่',
 SIGNATURE_INVALID:'ลายเซ็นของชุดติดตั้งไม่ถูกต้อง จึงไม่ติดตั้งต่อ',
 PACKAGE_FILESET_MISMATCH:'ไฟล์ติดตั้งไม่ครบหรือมีไฟล์เกิน จึงไม่ติดตั้งต่อ'
};
const BUSY_TEXT='ยังมีงานเบื้องหลังค้างอยู่ (มักเกิดหลังระบบหยุดกะทันหัน) จึงยังสำรองข้อมูลก่อนอัปเกรดไม่ได้ ระบบเดิมกลับมาทำงานตามปกติและข้อมูลไม่เสียหาย กรุณารอประมาณ 15 นาทีแล้วเปิดตัวติดตั้งอีกครั้ง';
const HEALTH_TEXT='ระบบยังไม่ผ่านการตรวจความพร้อมภายในเวลาที่กำหนด รายละเอียดบริการและฐานข้อมูลที่ไม่ผ่านอยู่ในไฟล์ Log ถ้าเป็นการอัปเกรด อย่าถอนการติดตั้งหรือสรุปว่าระบบย้อนกลับแล้ว ให้ตรวจ Status และ Log ก่อนดำเนินการต่อ';
const GENERIC_TEXT='การติดตั้งไม่สำเร็จ รายละเอียดทางเทคนิคอยู่ในไฟล์ Log ข้อมูลเดิม (ถ้ามี) ไม่ถูกลบ';
const ERRORS={...CODE,BACKUP_BUSY:BUSY_TEXT,TIMEOUT_HEALTH:HEALTH_TEXT,GENERIC:GENERIC_TEXT};
// the stable key the wizard uses to show the same sentence from its own table
export function errorKey(code,detail){
 if(code==='PREFLIGHT_FAILED'&&Array.isArray(detail)&&detail.some(c=>!SOFT_CHECKS.has(c.id)))return 'PREFLIGHT_FAILED';
 if(code==='BACKUP_FAILED'&&/QUEUE_NOT_QUIESCENT|WORKER_OR_WRITER_NOT_QUIESCENT/.test(String(detail)))return 'BACKUP_BUSY';
 if(String(code).startsWith('TIMEOUT_HEALTH'))return 'TIMEOUT_HEALTH';
 return CODE[code]?code:'GENERIC';
}
export function thaiError(code,detail){
 const key=errorKey(code,detail);
 if(key==='PREFLIGHT_FAILED'){
  const lines=[...new Set(detail.filter(c=>!SOFT_CHECKS.has(c.id)).map(thaiCheck))];
  return 'ยังติดตั้งไม่ได้ เพราะ:\n- '+lines.join('\n- ');
 }
 return ERRORS[key];
}
const STEPS=[
 ['verifying',5,'กำลังตรวจความสมบูรณ์ของชุดติดตั้ง'],
 ['creating layout',12,'กำลังสร้างโฟลเดอร์ระบบ'],
 ['copying runtime and release',25,'กำลังคัดลอกโปรแกรม (ไม่ต้องใช้อินเทอร์เน็ต)'],
 ['generating secrets',45,'กำลังสร้างกุญแจความปลอดภัยและใบรับรอง HTTPS'],
 ['reusing the retained',55,'กำลังใช้ฐานข้อมูลเดิมที่เก็บไว้'],
 ['initializing the private PostgreSQL',55,'กำลังเตรียมฐานข้อมูล PostgreSQL ส่วนตัว'],
 ['applying forward migrations',65,'กำลังปรับปรุงโครงสร้างฐานข้อมูล'],
 ['migrating the database',65,'กำลังสร้างโครงสร้างฐานข้อมูลและบัญชีผู้ดูแลระบบเริ่มต้น'],
 ['registering the startup task',78,'กำลังตั้งให้ระบบเริ่มทำงานเอง'],
 ['taking the first verified backup',90,'กำลังสร้างข้อมูลสำรองครั้งแรกและตรวจสอบ'],
 ['pre-upgrade verified backup',30,'กำลังสำรองข้อมูลก่อนอัปเกรด'],
 ['staging release',50,'กำลังเตรียมเวอร์ชันใหม่'],
 ['applying forward migrations (',65,'กำลังปรับปรุงฐานข้อมูล'],
 ['checking the network address',95,'กำลังตรวจที่อยู่สำหรับเครื่องอื่นใน LAN']
];
// texts Setup itself reports (not from the engine); together with STEPS they form the table the wizard shows by index
const EXTRA_STEP_TEXTS=['กำลังเริ่มการติดตั้ง','กำลังตรวจความพร้อมของเครื่อง','ติดตั้งเวอร์ชันนี้อยู่แล้ว กำลังตรวจสถานะ','พบเวอร์ชันเดิม กำลังอัปเกรดโดยรักษาข้อมูลเดิม','ติดตั้งเสร็จสมบูรณ์'];
export const STEP_TEXTS=[...STEPS.map(s=>s[2]),...EXTRA_STEP_TEXTS];
export const stepIndex=text=>STEP_TEXTS.indexOf(text);
export function thaiStep(line){
 const s=String(line).replace(/^\[nipt\]\s*/,'');
 for(const [needle,percent,text] of STEPS)if(s.includes(needle))return {percent,text,index:stepIndex(text)};
 return null;
}
export const THAI_WARNING={
 EXCEL_MISSING:'ไม่พบ Microsoft Excel บนเครื่องนี้: ระบบหลักใช้งานได้ แต่การสร้างไฟล์ PDF ของ Task List จะใช้ไม่ได้จนกว่าจะติดตั้ง Excel (ยังไม่ได้ทดสอบส่วนนี้)',
 PRINTER_MISSING:'ผู้ใช้นี้ยังไม่มีเครื่องพิมพ์เริ่มต้น: Excel ต้องใช้เครื่องพิมพ์เริ่มต้น (เครื่องพิมพ์ PDF ก็ได้) เพื่อสร้าง PDF ขนาด A4',
 FIREWALL_NOT_CREATED:'ยังไม่ได้เปิดพอร์ตใน Windows Firewall (ต้องใช้สิทธิ์ผู้ดูแลระบบ): เครื่องอื่นใน LAN จะยังเข้าไม่ได้ จนกว่าจะตั้งค่า',
 FIREWALL_RULE_MISSING:'ไม่พบกฎ Windows Firewall ของระบบ: เครื่องอื่นอาจเข้าไม่ได้',
 NETWORK_PUBLIC:'ประเภทเครือข่ายปัจจุบันของเครื่องนี้ไม่อยู่ในที่ที่กฎ Windows Firewall ครอบคลุม (ปกติคือ Public): เครื่องอื่นจะเข้าไม่ได้ ให้เปลี่ยนประเภทเครือข่ายเป็น Private/Domain หรือสั่ง nipt.cmd set-lan --profiles Domain,Private,Public',
 CERT_NOT_TRUSTED:'ใบรับรอง HTTPS เป็นแบบสร้างเอง: Browser ของเครื่องอื่นจะแจ้งเตือนครั้งแรก ให้กดยอมรับ หรือติดตั้งใบรับรองจากลิงก์ดาวน์โหลดในคู่มือ',
 LAN_PROBE_FAILED:'ตรวจ URL จากเครื่องนี้ไม่ผ่าน: อย่าเพิ่งแจ้งผู้ใช้ ให้ตรวจ Log และสถานะระบบ',
 HOST_CHANGED:'ที่อยู่ IP ของเครื่องนี้ไม่ตรงกับที่ตั้งไว้ตอนติดตั้ง: ใช้ nipt.cmd set-lan เพื่อตั้ง URL ใหม่',
 RESTART_NOT_TESTED:'ระบบถูกตั้งให้เริ่มทำงานเองเมื่อผู้ใช้เข้าสู่ Windows (ไม่ใช่ตอนเปิดเครื่องเฉยๆ)',
 WORD_MISSING:'ไม่พบ Microsoft Word บนเครื่องนี้: ระบบหลักใช้งานได้ แต่ไฟล์ PDF ผลตรวจ NIPT (ชื่อ เลขใบอนุญาต และลายเซ็น) จะสร้างไม่ได้จนกว่าจะติดตั้งและเปิดใช้งาน Word',
 OFFICE_SESSION:'Word และ Excel ทำงานได้เมื่อมีผู้ใช้ Windows ที่ติดตั้งระบบลงชื่อเข้าใช้อยู่เท่านั้น หลังไฟดับหรือรีสตาร์ต ต้องตั้ง Automatic sign-in ของบัญชีนั้นโดยฝ่าย IT โรงพยาบาล และต้องทดสอบรีบูตจริงด้วยคำสั่ง office-check ก่อนใช้งานจริง (ตัวติดตั้งยังไม่ได้พิสูจน์ข้อนี้)'
};
export function thaiLanWarnings(lan,{admin,networkCategory}={}){
 const out=[];
 if(!lan)return out;
 if(lan.enabled&&!lan.probe?.reachableFromThisServer)out.push(THAI_WARNING.LAN_PROBE_FAILED);
 if(lan.enabled&&!admin&&!lan.firewall?.exists)out.push(THAI_WARNING.FIREWALL_NOT_CREATED);
 else if(lan.enabled&&!lan.firewall?.exists)out.push(THAI_WARNING.FIREWALL_RULE_MISSING);
 for(const w of lan.warnings??[]){
  if(w.startsWith('NETWORK_CATEGORY_NOT_COVERED'))out.push(THAI_WARNING.NETWORK_PUBLIC);
  if(w==='HOST_IS_NOT_THIS_SERVERS_CURRENT_ADDRESS')out.push(THAI_WARNING.HOST_CHANGED);
 }
 if(lan.enabled&&!lan.certificateTrustedOnThisServer)out.push(THAI_WARNING.CERT_NOT_TRUSTED);
 void networkCategory;
 return [...new Set(out)];
}

export const warningKey=text=>Object.keys(THAI_WARNING).find(k=>THAI_WARNING[k]===text)??'';
// Pascal tables for the Inno wizard. The wizard receives only ASCII codes from Setup (step index, warning and error codes) and shows
// the Thai text from these literals: files read by the wizard are never trusted to carry Thai text.
const lit=t=>String(t).split('\n').map(p=>`'${p.replace(/'/g,"''")}'`).join(' + #13#10 + ');
export function pascalTables(){
 const out=[];
 out.push('function StepText(Index: Integer): String;','begin',"  Result := '';");
 STEP_TEXTS.forEach((t,i)=>out.push(`  if Index = ${i} then Result := ${lit(t)};`));
 out.push('end;','');
 out.push('function WarningText(const Code: String): String;','begin',"  Result := '';");
 for(const [k,v] of Object.entries(THAI_WARNING))out.push(`  if Code = '${k}' then Result := ${lit(v)};`);
 out.push('end;','');
 out.push('function ErrorText(const Code: String): String;','begin',"  Result := '';");
 for(const k of Object.keys(ERRORS))out.push(`  if Code = '${k}' then Result := ${lit(ERRORS[k])};`);
 out.push('end;','');
 out.push('function CheckText(const Id, Detail: String): String;','begin',"  Result := '';");
 for(const id of Object.keys(CHECK))out.push(`  if Id = '${id}' then Result := ${lit(CHECK[id])};`);
 for(const d of Object.keys(ROOT))out.push(`  if (Id = 'install_root_safe') and (Detail = '${d}') then Result := ${lit(ROOT[d])};`);
 const port=thaiCheck({id:'port_x',detail:'@@D@@'}).split('@@D@@');
 out.push(`  if Copy(Id, 1, 5) = 'port_' then Result := ${lit(port[0])} + Detail + ${lit(port[1])};`);
 out.push("  if Result = '' then Result := 'การตรวจสอบก่อนติดตั้งไม่ผ่าน: ' + Id;",'end;','');
 return out.join('\r\n');
}

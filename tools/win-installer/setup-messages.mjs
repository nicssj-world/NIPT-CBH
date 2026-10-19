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
 lan_address:'ไม่พบที่อยู่ IP ของเครื่องนี้ในเครือข่าย LAN (ต้องเสียบสายเครือข่ายและมี Default Gateway)',
 default_printer_current_user:'ยังไม่มีเครื่องพิมพ์เริ่มต้นของผู้ใช้นี้'
};
const ROOT={
 INSTALL_ROOT_MUST_BE_ASCII:'ชื่อโฟลเดอร์ติดตั้งต้องเป็นตัวอักษรภาษาอังกฤษ ตัวเลข หรือช่องว่างเท่านั้น (PostgreSQL ใช้ชื่อโฟลเดอร์ภาษาไทยไม่ได้) เช่น C:\\NIPT-CBH',
 INSTALL_ROOT_TOO_SHORT:'ชื่อโฟลเดอร์ติดตั้งสั้นเกินไป',
 INSTALL_ROOT_IS_DRIVE_ROOT:'ห้ามติดตั้งที่รากของไดรฟ์ ให้ระบุโฟลเดอร์ เช่น C:\\NIPT-CBH'
};
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
 UPGRADE_FAILED_HEALTH:'อัปเกรดแล้วระบบเวอร์ชันใหม่เริ่มทำงานไม่ได้ ระบบย้อนกลับไปเวอร์ชันเดิมให้แล้ว ข้อมูลเดิมยังอยู่ครบ',
 UPGRADE_MIGRATION_FAILED_OLD_RELEASE_STILL_RUNNING:'อัปเกรดฐานข้อมูลไม่สำเร็จ ระบบเวอร์ชันเดิมยังทำงานอยู่ตามปกติ ข้อมูลเดิมยังอยู่ครบ',
 UPGRADE_MIGRATION_FAILED_RESTORE_REQUIRED:'อัปเกรดฐานข้อมูลไม่สำเร็จ ต้องกู้คืนจากข้อมูลสำรองก่อนอัปเกรด (ข้อมูลสำรองถูกสร้างไว้แล้ว) กรุณาติดต่อผู้พัฒนา',
 PROVISION_FAILED:'เตรียมฐานข้อมูลไม่สำเร็จ ระบบจะลบสิ่งที่ติดตั้งค้างไว้ให้',
 BACKUP_FAILED:'สร้างข้อมูลสำรองครั้งแรกไม่สำเร็จ',
 LAN_ADDRESS_NOT_FOUND:'ไม่พบที่อยู่ IP ของเครื่องนี้ในเครือข่าย LAN',
 NO_FREE_PORT:'ไม่พบพอร์ตว่างสำหรับระบบ กรุณาปิดโปรแกรมที่ใช้พอร์ตจำนวนมากแล้วลองใหม่',
 PACKAGE_CHECKSUM_MISMATCH:'ไฟล์ติดตั้งเสียหายหรือถูกแก้ไข (ตรวจความสมบูรณ์ไม่ผ่าน) กรุณาคัดลอกไฟล์ติดตั้งใหม่',
 SIGNATURE_INVALID:'ลายเซ็นของชุดติดตั้งไม่ถูกต้อง จึงไม่ติดตั้งต่อ',
 PACKAGE_FILESET_MISMATCH:'ไฟล์ติดตั้งไม่ครบหรือมีไฟล์เกิน จึงไม่ติดตั้งต่อ'
};
export function thaiError(code,detail){
 if(code==='PREFLIGHT_FAILED'&&Array.isArray(detail)&&detail.length){
  const lines=[...new Set(detail.filter(c=>!(c.id==='excel_installed')&&!(c.id==='default_printer_current_user')).map(thaiCheck))];
  if(lines.length)return 'ยังติดตั้งไม่ได้ เพราะ:\n- '+lines.join('\n- ');
 }
 if(code==='BACKUP_FAILED'&&/QUEUE_NOT_QUIESCENT|WORKER_OR_WRITER_NOT_QUIESCENT/.test(String(detail)))return 'ยังมีงานเบื้องหลังค้างอยู่ (มักเกิดหลังระบบหยุดกะทันหัน) จึงยังสำรองข้อมูลก่อนอัปเกรดไม่ได้ ระบบเดิมกลับมาทำงานตามปกติและข้อมูลไม่เสียหาย กรุณารอประมาณ 15 นาทีแล้วเปิดตัวติดตั้งอีกครั้ง';
 if(String(code).startsWith('TIMEOUT_HEALTH'))return 'ติดตั้งแล้วแต่ระบบยังไม่พร้อมใช้งานภายในเวลาที่กำหนด ระบบจะลบสิ่งที่ติดตั้งค้างไว้ให้ (ถ้าเป็นการติดตั้งใหม่) รายละเอียดอยู่ในไฟล์ Log';
 return CODE[code]??'การติดตั้งไม่สำเร็จ รายละเอียดทางเทคนิคอยู่ในไฟล์ Log ข้อมูลเดิม (ถ้ามี) ไม่ถูกลบ';
}
const STEPS=[
 ['verifying',5,'กำลังตรวจความสมบูรณ์ของชุดติดตั้ง'],
 ['creating layout',12,'กำลังสร้างโฟลเดอร์ระบบ'],
 ['copying runtime and release',25,'กำลังคัดลอกโปรแกรม (ไม่ต้องใช้อินเทอร์เน็ต)'],
 ['generating secrets',45,'กำลังสร้างกุญแจความปลอดภัยและใบรับรอง HTTPS'],
 ['reusing the retained',55,'กำลังใช้ฐานข้อมูลเดิมที่เก็บไว้'],
 ['initializing the private PostgreSQL',55,'กำลังเตรียมฐานข้อมูล PostgreSQL ส่วนตัว'],
 ['applying forward migrations',65,'กำลังปรับปรุงโครงสร้างฐานข้อมูล'],
 ['migrating the database',65,'กำลังสร้างโครงสร้างฐานข้อมูลและบัญชีผู้ใช้ทดสอบ'],
 ['registering the startup task',78,'กำลังตั้งให้ระบบเริ่มทำงานเอง'],
 ['taking the first verified backup',90,'กำลังสร้างข้อมูลสำรองครั้งแรกและตรวจสอบ'],
 ['pre-upgrade verified backup',30,'กำลังสำรองข้อมูลก่อนอัปเกรด'],
 ['staging release',50,'กำลังเตรียมเวอร์ชันใหม่'],
 ['applying forward migrations (',65,'กำลังปรับปรุงฐานข้อมูล'],
 ['checking the network address',95,'กำลังตรวจที่อยู่สำหรับเครื่องอื่นใน LAN']
];
export function thaiStep(line){
 const s=String(line).replace(/^\[nipt\]\s*/,'');
 for(const [needle,percent,text] of STEPS)if(s.includes(needle))return {percent,text};
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
 RESTART_NOT_TESTED:'ระบบถูกตั้งให้เริ่มทำงานเองเมื่อผู้ใช้เข้าสู่ Windows (ไม่ใช่ตอนเปิดเครื่องเฉยๆ)'
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

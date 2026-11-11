/** Thai words for the sync outcome codes (packages/calendar/holiday-sync). Codes only travel over the API; the URL and the body never do. */
export const HOLIDAY_SYNC_MESSAGES:Record<string,string>={
 ICAL_URL_HTTPS_REQUIRED:'ลิงก์ปฏิทินต้องขึ้นต้นด้วย https://',
 ICAL_TIMEOUT:'ปฏิทินไม่ตอบกลับภายใน 15 วินาที',
 ICAL_UNREACHABLE:'เชื่อมต่อปฏิทินไม่ได้ (ตรวจอินเทอร์เน็ตของเครื่องแม่ข่าย)',
 ICAL_TOO_LARGE:'ไฟล์ปฏิทินใหญ่เกิน 2 MB',
 ICAL_NO_HOLIDAYS:'ไม่พบวันหยุดในปฏิทินนี้',
 ICS_NOT_CALENDAR:'ลิงก์นี้ไม่ใช่ไฟล์ปฏิทิน iCal (.ics)',
 ICAL_SYNC_FAILED:'ซิงก์ไม่สำเร็จ',
};
export const holidaySyncMessage=(code:string|null)=>!code?null:HOLIDAY_SYNC_MESSAGES[code]??(/^ICAL_HTTP_(\d{3})$/.test(code)?`ปฏิทินตอบกลับรหัส ${code.slice(10)}`:'ซิงก์ไม่สำเร็จ');

import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {VendorExportNotice} from '../../src/components/p4/vendor-export-notice';

it('shows every affected position, exact missing fields and case links without navigating away from the worksheet',()=>{
 const html=renderToStaticMarkup(createElement(VendorExportNotice,{issues:[
  {slot:46,sampleId:'SYNTHETIC-46',caseId:'c1006847-c4aa-4d20-8130-38967830df95',problems:['กำหนดคลอด (EDD)','ประเภทครรภ์ (ครรภ์เดี่ยว/แฝด)']},
  {slot:47,sampleId:'SYNTHETIC-47',caseId:'a92cc2c6-2c83-49e2-a9bb-6648f82a59ff',problems:['ไม่พบหลักฐาน PET ของตัวอย่าง']},
 ]}));
 expect(html).toContain('role="alert"');
 expect(html).toContain('ส่งออก XLSX ไม่สำเร็จ');
 for(const text of ['ตำแหน่ง 46','SYNTHETIC-46','กำหนดคลอด (EDD)','ประเภทครรภ์ (ครรภ์เดี่ยว/แฝด)','ตำแหน่ง 47','SYNTHETIC-47','ไม่พบหลักฐาน PET ของตัวอย่าง'])expect(html).toContain(text);
 expect(html).toContain('href="/cases/c1006847-c4aa-4d20-8130-38967830df95"');
 expect(html.match(/target="_blank"/g)).toHaveLength(2);
 expect(html).toContain('rel="noopener"');
 expect(html).toContain('ยังไม่ได้สร้างไฟล์ส่งออก');
});

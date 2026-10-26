import {it,expect} from 'vitest';
import {readTable} from '../../packages/historical/table';
import {TABLE_COLUMNS} from '../../packages/historical/columns';
import {singlePatientCsv} from '../../src/components/p5h/single-patient';

// OWNER-LAB-005: the single-patient form produces exactly one template row that the real table reader accepts.
it('single-patient CSV has every template column and parses as one row with values preserved',()=>{
 const csv=singlePatientCsv({ln:'9905300001',hn:'0012345',name:'ผู้รับบริการจำลอง, ทดสอบ "หนึ่ง"',dob:'1990-01-31',report_date:'2025-02-03',original_location:'ตู้ A ชั้น 2',pregnancy_type:'Twins',pdf_file:'a.pdf'});
 expect(csv.split('\r\n')[0].replace('﻿','')).toBe(TABLE_COLUMNS.map(c=>c.key).join(','));
 const table=readTable('single.csv',Buffer.from(csv,'utf8'));
 expect(table.rows).toHaveLength(1);
 const row=table.rows[0];
 expect(row.rowNo).toBe(2);
 expect(row.cells).toMatchObject({ln:'9905300001',hn:'0012345',name:'ผู้รับบริการจำลอง, ทดสอบ "หนึ่ง"',dob:'1990-01-31',report_date:'2025-02-03',original_location:'ตู้ A ชั้น 2',pregnancy_type:'Twins',pdf_file:'a.pdf'});
});

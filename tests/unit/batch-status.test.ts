import {expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BatchStatus,batchStatusText} from '../../src/components/p4/batch-status';

it.each([
 [{state:'InPreparation'},'เตรียมงาน'],
 [{state:'InPreparation',qc_saved:true},'บันทึก QC แล้ว'],
 [{state:'InPreparation',qc_saved:true,pool_exported:true},'ส่งออกไฟล์ Pooling แล้ว'],
 [{state:'InPreparation',qc_saved:true,pool_exported:true,pooling_recorded:true},'บันทึก Pooling แล้ว'],
 [{state:'InPreparation',pooling_recorded:true},'บันทึก Pooling แล้ว'],
 [{state:'InPreparation',pooling_recorded:true,seq_files_exported:true},'ส่งออกไฟล์ Sequencing แล้ว'],
 [{state:'Cancelled',pooling_recorded:true,seq_files_exported:true},'ยกเลิก'],
])('shows one latest status for %j',(progress,expected)=>{
 const html=renderToStaticMarkup(createElement(BatchStatus,progress));
 expect(batchStatusText(progress)).toBe(expected);
 expect(html.match(/class="badge"/g)).toHaveLength(1);
 expect(html).toContain(expected);
 if(expected!=='เตรียมงาน')expect(html).not.toContain('เตรียมงาน');
});


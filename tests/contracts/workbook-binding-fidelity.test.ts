import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {verifyBindingFidelity} from '../../tools/operational/verify-binding-fidelity';
import {generateTaskWorkbook,inspectTaskMaster} from '../../packages/workbook/master';
import {readArchive} from '../../packages/workbook/archive';

const source=process.env.NIPT_TASK_MASTER_PATH??'.local/lab-owner-evidence/lab-combined-master.xlsx';
describe.skipIf(!existsSync(source))('Exhaustive exact-master binding verification',()=>{
  it('fits a long filled HALOS identifier using a cloned alignment, preserving the source font and all original styles',()=>{
    const master=readFileSync(source),before=readArchive(master),out=readArchive(generateTaskWorkbook(master,{'slot.1.printedSampleId':'26B261015001R-VERY-LONG-ID'}).bytes);
    const styles=(bytes:Buffer)=>/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(bytes.toString())![1];
    expect(styles(out.get('xl/styles.xml')!)).toContain(styles(before.get('xl/styles.xml')!));
    expect(out.get('xl/styles.xml')!.toString()).toContain('shrinkToFit="1"');
    const fonts=(bytes:Buffer)=>/<fonts\b[^>]*>[\s\S]*?<\/fonts>/.exec(bytes.toString())![0];
    expect(fonts(out.get('xl/styles.xml')!)).toBe(fonts(before.get('xl/styles.xml')!));
    expect(out.get('xl/worksheets/sheet1.xml')!.toString()).toContain('26B261015001R-VERY-LONG-ID');
  });
  it('independently reads every declared binding and proves individual locality, merged anchors and immutable layout/media',()=>{
    const result=verifyBindingFidelity(readFileSync(source));
    expect(result.evidence.bindingCount).toBe(316);
    expect(result.evidence.formulaCount).toBe(149);
    expect(result.evidence.readback).toHaveLength(316);
    expect(result.evidence.media).toHaveLength(25);
    expect(result.evidence.media.every(m=>m.unchanged)).toBe(true);
  },180000);
  it('binds the actual sequencing chip confirmation while preserving all source rich runs, including unchecked state',()=>{
    const master=readFileSync(source),definition=inspectTaskMaster(master).bindings.find(b=>b.key==='seq.chipPositionedFirmly');
    expect(definition).toMatchObject({sheet:'Seq Task-G50',cell:'B26',dataType:'checkbox',rendering:'parentheses'});
    const cell=(bytes:Buffer)=>/<c\b[^>]*\br="B26"[^>]*>([\s\S]*?)<\/c>/.exec(readArchive(bytes).get('xl/worksheets/sheet6.xml')!.toString())![1];
    const unchecked=cell(generateTaskWorkbook(master,{'seq.chipPositionedFirmly':false}).bytes);
    const checked=cell(generateTaskWorkbook(master,{'seq.chipPositionedFirmly':true}).bytes);
    expect(unchecked).toContain('Sequencing chip positioned firmly (  )');
    expect(checked).toBe(unchecked.replace('(  )','( ✓ )'));
    expect(()=>generateTaskWorkbook(master,{'seq.chipPositionedFirmly':'yes'})).toThrow('TASK_FIELD_TYPE');
  });
});

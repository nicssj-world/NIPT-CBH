import {readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {generateTaskWorkbook} from '../../packages/workbook/master';
import {readArchive} from '../../packages/workbook/archive';
import {applyPoolingRules} from '../../packages/workbook/pooling-rules';
import {applyPoolingLayout} from '../../packages/workbook/pooling-layout';
import {calculateOwnerPooling,renderPoolingCsv,type PhysicalQc} from '../../packages/pooling/owner-master';
const master=readFileSync('.local/lab-owner-evidence/lab-combined-master.xlsx');

// Owner rule 2026-11-07: Blank (slot 40) and a slot going to Re-xxx are not pooled. The printed Pooling Table is recalculated by Excel from the master
// formula, so the generated copy must carry the same rule or the PDF disagrees with the CSV and the screen.
const concentration=(slot:number)=>slot===40?0.4:slot===12?9:20;           // Blank has a QC value; slot 12 is a Re-xxx slot that still holds an old value
const values:Record<string,unknown>={};for(let i=1;i<=48;i++)values[`slot.${i}.libraryQc`]=concentration(i);
const cell=(xml:string,ref:string)=>new RegExp('<c r="'+ref+'"[^>]*>([\\s\\S]*?)</c>').exec(xml)?.[1]??'';
const sheet=(poolExcludedSlots?:number[])=>readArchive(generateTaskWorkbook(master,values,{poolExcludedSlots}).bytes).get('xl/worksheets/sheet5.xml')!.toString();

it('the Pooling Table formulas follow the rule: excluded slots have no volume and the divisor leaves them out',()=>{
 const xml=sheet([12,40]);
 const c19=cell(xml,"C19"),c47=cell(xml,"C47");expect([c19,c47]).toEqual([expect.stringContaining("<f>\"\"</f>"),expect.stringContaining("<f>\"\"</f>")]);
 const patient=cell(xml,'C8');
 expect(patient).toContain("COUNTA('QC measurements'!$C$7:$C$54)-COUNTA('QC measurements'!C18,'QC measurements'!C46)");
 expect(patient).toContain("160/(");
});
it('the count Excel will compute from those formulas equals the screen/CSV calculation for the same data',()=>{
 const rows:PhysicalQc[]=Array.from({length:48},(_,i)=>{const slot=i+1;return {slot,sampleId:'S'+slot,kind:slot===1?'PC':slot===25?'NC':slot===40?'BLANK':slot===12?'REPEAT':'PATIENT',concentration:String(concentration(slot))};});
 const app=calculateOwnerPooling(master,rows,'16');
 // What COUNTA would give in Excel: every QC cell holds a number, minus the excluded slots that hold one.
 const excelCount=48-2;
 expect(app.measuredCount).toBe(excelCount);
 const excelVolume=(slot:number)=>160/excelCount*16/concentration(slot);
 for(const r of app.rows.filter(r=>!['BLANK','REPEAT'].includes(r.kind)))expect(Number(r.volume)).toBeCloseTo(excelVolume(r.slot),9);
 expect(app.rows.find(r=>r.slot===40)!.volume).toBeNull();expect(app.rows.find(r=>r.slot===12)!.volume).toBeNull();
});
it('with nothing excluded the generated Pooling Table is exactly what it was; every other formula is untouched',()=>{
 const parts=readArchive(master);applyPoolingLayout(parts);const base=parts.get('xl/worksheets/sheet5.xml')!.toString();
 expect(sheet()).not.toContain('<f>""</f>');
 expect([...sheet([40]).matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].length).toBe([...base.matchAll(/<f\b[^>]*>[\s\S]*?<\/f>/g)].length);   // formula count unchanged
});
it('a template change can never silently skip the rule',()=>{
 const parts=readArchive(master);applyPoolingLayout(parts);
 parts.set('xl/worksheets/sheet5.xml',Buffer.from(parts.get('xl/worksheets/sheet5.xml')!.toString().replaceAll('160/COUNTA','160/COUNT')));
 expect(()=>applyPoolingRules(parts,[40])).toThrow('POOL_RULE_FORMULA_NOT_FOUND');
});

it('CSV column F: two decimals (half up), the Blank control is always 0, below-2 stays 0, an excluded Re-xxx slot stays empty (Owner 2026-11-09)',()=>{
 const rows:PhysicalQc[]=Array.from({length:48},(_,i)=>{const slot=i+1;return {slot,sampleId:'S'+slot,kind:slot===1?'PC':slot===25?'NC':slot===40?'BLANK':slot===48?'REPEAT':'PATIENT',concentration:slot===48?null:slot===40?'0.4':slot===2?'80':slot===3?'7.7':'20'};});
 const r=calculateOwnerPooling(master,rows,'16'),f=(slot:number)=>r.rows[slot-1].csvVolume;
 expect(f(40)).toBe('0');                                   // Blank always 0, even with a QC value entered
 expect(f(48)).toBe('');                                    // Re-xxx slot is not pooled: left empty
 expect(f(2)).toBe('0');expect(r.rows[1].belowTwo).toBe(true);   // below 2 µL is written as 0 (unchanged rule)
 for(const slot of [1,3,4,25])expect(f(slot)).toMatch(/^\d+\.\d{2}$/);
 expect(f(4)).toBe((Math.round(160/46*16/20*100)/100).toFixed(2));   // 46 measured: 48 minus Blank minus the unmeasured Re-xxx slot
 expect(Number(r.rows[3].volume)).toBeCloseTo(160/46*16/20,12);      // the screen and totals keep the unrounded value
});

it('Pooling CSV leaves a Re-xxx slot out of the file; the others keep their own source positions; rebuilding later shows the sample again',()=>{
 const positions=Array.from({length:48},(_,i)=>`${Math.floor(i/8)+1}${'ABCDEFGH'[i%8]}`);
 const template=['Sample Name,The Source Plate,The Number Of The Source,Pooling Position,Pooling Source,Pooling Volume',...positions.map(p=>`x,POS1-1,${p},POS5,3A,`),''].join('\r\n');
 const rows=(kinds:Record<number,PhysicalQc['kind']>):PhysicalQc[]=>Array.from({length:48},(_,i)=>{const slot=i+1;const kind=kinds[slot]??(slot===1?'PC':slot===25?'NC':slot===40?'BLANK':'PATIENT');return {slot,sampleId:'S'+slot,kind,concentration:kind==='REPEAT'?null:'20'};});
 const first=renderPoolingCsv(template,calculateOwnerPooling(master,rows({7:'REPEAT',48:'REPEAT'}),'16')).toString().split('\r\n');
 expect(first).toHaveLength(48);                                          // header + 46 rows + final newline
 expect(first.join('|')).not.toMatch(/S7,|S48,/);                         // the Re-xxx samples are not in the file
 expect(first.find(l=>l.startsWith('S6,'))!.split(',')[2]).toBe('1F');    // neighbours keep their own source position
 expect(first.find(l=>l.startsWith('S8,'))!.split(',')[2]).toBe('1H');
 expect(first.find(l=>l.startsWith('S40,'))!.split(',')[5]).toBe('0');    // Blank is still there, always 0
 // Next time (the Re-xxx order is gone or the sample is a normal pooled attempt) the same export shows the sample again.
 const later=renderPoolingCsv(template,calculateOwnerPooling(master,rows({}),'16')).toString().split('\r\n');
 expect(later).toHaveLength(50);expect(later.find(l=>l.startsWith('S7,'))!.split(',')[2]).toBe('1G');
});

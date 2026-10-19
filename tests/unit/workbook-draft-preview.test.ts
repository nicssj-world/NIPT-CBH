import {describe,expect,it,vi} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {PDFDocument} from 'pdf-lib';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {readArchive,sha256} from '../../packages/workbook/archive';
import {MASTER_SHA256,SHEETS} from '../../packages/workbook/master';
import {buildDraftTaskWorkbook,renderDraftTaskPdf} from '../../packages/workbook/draft-preview';

const masterPath=process.env.NIPT_TASK_MASTER_PATH??'C:/Users/User/Downloads/NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx';
const input={sheetNumber:1,runLabel:'Run999/2026',plan:{workDate:'18/10/2569',operator:'SYNTHETIC OPERATOR',extractionLot:'',extractionExpiry:'',libraryLot:'LOT-SYN',libraryExpiry:'20/10/2569'},rows:[{slot:1,printedId:'26N120261018-1'},{slot:2,printedId:'26B261018001-1'}],previewedAt:'2026-10-19T00:00:00Z',previewedBy:'synthetic-user'};

describe.skipIf(!existsSync(masterPath))('native uncontrolled Task draft preview (external approved Master)',()=>{
 it('starts from the checked Master, fills live plan/slots, clears unknown inputs and retains the two-page print setup',()=>{
  const master=readFileSync(masterPath),out=buildDraftTaskWorkbook(master,input),parts=readArchive(out);
  expect(sha256(master)).toBe(MASTER_SHA256);
  const sheet=parts.get('xl/worksheets/sheet1.xml')!.toString();
  expect(sheet).not.toContain('//>');
  for(const cell of ['D8','J8','B10','H8','B16'])expect(sheet).toMatch(new RegExp(`<c r="${cell}"[^/>]*\\/>`));
  for(const value of ['Run999/2026','SYNTHETIC OPERATOR','26N120261018-1','26B261018001-1','18/10/2569','LOT-SYN'])expect(sheet).toContain(value);
  for(const cell of ['D8','J8','B10','H8','B16']){const body=new RegExp(`<c\\b[^>]*r="${cell}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`).exec(sheet)?.[0]??'';expect(body).not.toMatch(/<v>|<t[^>]*>[^<]+/);}
  const original=readArchive(master).get('xl/worksheets/sheet1.xml')!.toString();
  expect(/<pageSetup\b[^>]*\/>/.exec(sheet)?.[0]).toBe(/<pageSetup\b[^>]*\/>/.exec(original)?.[0]);
  expect(()=>buildDraftTaskWorkbook(Buffer.from('wrong master'),input)).toThrow('TASK_MASTER_SHA256_MISMATCH');
 });
 it('exports only the selected native sheet, stamps DRAFT on both A4 pages and includes provenance metadata',async()=>{
  const master=readFileSync(masterPath),native=await PDFDocument.create();native.addPage([595.28,841.89]);native.addPage([595.28,841.89]);
  const render=vi.fn(async(bytes:Buffer,sheets:readonly string[])=>{expect(bytes.subarray(0,2).toString()).toBe('PK');return [{sheet:sheets[0],bytes:Buffer.from(await native.save())}];});
  const bytes=await renderDraftTaskPdf(input,{loadMaster:async()=>master,render});
  expect(render).toHaveBeenCalledOnce();expect(render.mock.calls[0][1]).toEqual([SHEETS[0]]);
  const pdf=await PDFDocument.load(bytes);expect(pdf.getPageCount()).toBe(2);expect(pdf.getSubject()).toContain(MASTER_SHA256);expect(pdf.getSubject()).toContain('synthetic-user');
  const loading=getDocument({data:new Uint8Array(bytes),useSystemFonts:false}),document=await loading.promise;
  try{for(let n=1;n<=2;n++){const page=await document.getPage(n);expect(page.getViewport({scale:1}).width).toBeCloseTo(595.28,1);expect((await page.getTextContent()).items.map(item=>'str'in item?item.str:'').join(' ')).toContain('DRAFT');}}finally{await loading.destroy();}
 });
 it.each([2,3])('uses the live identifiers and plan on Task %s without filling the other Task sheets',sheetNumber=>{
  const master=readFileSync(masterPath),first=(sheetNumber-1)*16+1,parts=readArchive(buildDraftTaskWorkbook(master,{...input,sheetNumber,rows:[{slot:first,printedId:'SYNTHETIC-SELECTED-TASK'}]}));
  const selected=parts.get(`xl/worksheets/sheet${sheetNumber}.xml`)!.toString();
  expect(selected).toContain('SYNTHETIC-SELECTED-TASK');expect(selected).toContain('Run999/2026');
  expect(parts.get('xl/worksheets/sheet1.xml')!.toString()).not.toContain('SYNTHETIC-SELECTED-TASK');
 });
 it('fails closed if the native renderer returns a single page',async()=>{
  const pdf=await PDFDocument.create();pdf.addPage([595.28,841.89]);
  await expect(renderDraftTaskPdf(input,{loadMaster:async()=>readFileSync(masterPath),render:async()=>[{sheet:SHEETS[0],bytes:Buffer.from(await pdf.save())}]})).rejects.toThrow('TASK_DRAFT_TWO_A4_PAGES_REQUIRED');
 });
});

import {describe,it,expect} from 'vitest';
import {fillReport,SIGNATURE_FRAME,TOKENS,type SignerSlot,type ReportValues} from '../../packages/readygen/docx';
import {readArchive,writeArchive,sha256} from '../../packages/workbook/archive';
import {signaturePng} from '../../tools/task3-uat/signature';
import {decideSignerProfile} from '../../packages/readygen/signers';
import type {Staff} from '../../packages/lab/core';

// Synthetic one-page master (NOT the Owner's file): same structure the real masters use for signatures — an anchored picture
// before each "Reported by:" / "Approved by:" label, text-token paragraphs, licence and QC lines.
const ph=(t:string)=>'$'+'{'+t+'}';
const pic=(rid:string)=>`<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="s"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:srcRect l="1000"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1800000" cy="600000"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic>`;
const drawing=(rid:string,id:number)=>`<w:p><w:r><w:drawing><wp:anchor behindDoc="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>1000000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>-50000</wp:posOffset></wp:positionV><wp:extent cx="1800000" cy="600000"/><wp:wrapNone/><wp:docPr id="${id}" name="P${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">${pic(rid)}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;
const para=(t:string)=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const tokens=TOKENS.SINGLETON.filter(t=>t!=='createdDate_cbh');
const documentXml=`<w:document><w:body>${tokens.map(t=>para(ph(t))).join('')}${drawing('rId5',1)}${para('Reported by: (Name)')}${para('(Medical Technologist license no. 11111)')}${para('Reported Date: '+ph('createdDate_cbh'))}${drawing('rId6',2)}${para('Approved by: (Name)')}${para('(Medical Technologist license no. 22222)')}${para('Approved Date: '+ph('createdDate_cbh'))}${para('QC: PASS')}</w:body></w:document>`;
const rels='<Relationships><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/master-a.png"/><Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/master-b.png"/></Relationships>';
const master=writeArchive(new Map<string,Buffer>([['word/document.xml',Buffer.from(documentXml)],['word/_rels/document.xml.rels',Buffer.from(rels)],['word/media/master-a.png',Buffer.from('MASTER-A')],['word/media/master-b.png',Buffer.from('MASTER-B')]]));
const values=Object.fromEntries([...TOKENS.SINGLETON,'qc','sampleType'].map(t=>[t,'v'])) as unknown as ReportValues;
const descriptor={sha256:sha256(master),code:'TEST'};
const slot=(w:number,h:number,seed:number):SignerSlot=>({name:'Test Signer',license:'12345',date:'01-Jan-2026',signature:{bytes:signaturePng(seed,w,h),media:'image/png',width:w,height:h}});
const extents=(xml:string)=>[...xml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)].map(m=>`${m[1]}x${m[2]}`);

describe('fillReport signature fitting (synthetic master)',()=>{
 it('fits a wide and a tall signature inside the template frame, keeps their bytes, never uses the master images',()=>{
  const reported=slot(1200,100,1),approved=slot(100,400,2);
  const out=fillReport(master,'SINGLETON',values,{reported,approved},descriptor),parts=readArchive(out.bytes),xml=parts.get('word/document.xml')!.toString('utf8');
  expect(extents(xml)).toEqual(['1800000x150000','150000x600000']);
  expect((xml.match(/<a:ext cx="1800000" cy="150000"\/>/g)??[]).length).toBe(1);expect((xml.match(/<a:ext cx="150000" cy="600000"\/>/g)??[]).length).toBe(1);
  expect(xml).toContain('<wp:posOffset>175000</wp:posOffset>');   // wide: -50000 + 225000
  expect(xml).toContain('<wp:posOffset>1825000</wp:posOffset>');  // tall: 1000000 + 825000
  expect(xml).not.toContain('a:srcRect');
  expect(parts.get('word/media/t3-signature-reported.png')!.equals(reported.signature!.bytes)).toBe(true);
  expect(parts.get('word/media/t3-signature-approved.png')!.equals(approved.signature!.bytes)).toBe(true);
  expect([...parts.keys()].some(k=>/master-/.test(k))).toBe(false);
  const pick=(t:string)=>out.bindings.filter(b=>b.token===t).map(b=>`${b.role}:${b.value}`);
  expect(pick('signature.fit')).toEqual(['REPORTED:FITTED','APPROVED:FITTED']);
  expect(pick('signature.frame')).toEqual(['REPORTED:1800000x600000','APPROVED:1800000x600000']);
  expect(pick('signature.fitted')).toEqual(['REPORTED:1800000x150000','APPROVED:150000x600000']);
 });
 it('a signature with the frame aspect ratio leaves the frame as the master has it',()=>{
  const out=fillReport(master,'SINGLETON',values,{reported:slot(300,100,1),approved:slot(300,100,2)},descriptor),xml=readArchive(out.bytes).get('word/document.xml')!.toString('utf8');
  expect(extents(xml)).toEqual(['1800000x600000','1800000x600000']);expect(xml).toContain('<wp:posOffset>1000000</wp:posOffset>');expect(xml).toContain('<wp:posOffset>-50000</wp:posOffset>');
 });
 it('without a signature the transparent placeholder is used and the frame is untouched',()=>{
  const none:SignerSlot={name:'—',license:'—',date:'—',signature:null};
  const out=fillReport(master,'SINGLETON',values,{reported:none,approved:none},descriptor),parts=readArchive(out.bytes);
  expect(extents(parts.get('word/document.xml')!.toString('utf8'))).toEqual(['1800000x600000','1800000x600000']);expect(parts.get('word/media/t3-signature-reported.png')!.length).toBeGreaterThan(0);
 });
 it('Owner 2026-11-10: a template without signature pictures is filled with the chosen signers\' name, licence and date only',()=>{
  const plain=writeArchive(new Map<string,Buffer>([['word/document.xml',Buffer.from(documentXml.replace(drawing('rId5',1),'').replace(drawing('rId6',2),''))],['word/_rels/document.xml.rels',Buffer.from('<Relationships></Relationships>')]]));
  const out=fillReport(plain,'SINGLETON',values,{reported:slot(300,100,1),approved:slot(300,100,2)},{sha256:sha256(plain),code:'TEST'}),parts=readArchive(out.bytes),xml=parts.get('word/document.xml')!.toString('utf8');
  expect(xml).toContain('Test Signer');expect(xml).toContain('12345');expect(xml).toContain('01-Jan-2026');
  expect([...parts.keys()].some(k=>/t3-signature/.test(k))).toBe(false);
  expect(out.bindings.some(b=>b.token==='signature.fit')).toBe(false);
 });
 it('a template with a picture for one signer only keeps that picture and adds none for the other',()=>{
  const one=writeArchive(new Map(readArchive(master)).set('word/document.xml',Buffer.from(documentXml.replace(drawing('rId6',2),''))));
  const parts=readArchive(fillReport(one,'SINGLETON',values,{reported:slot(300,100,1),approved:slot(300,100,2)},{sha256:sha256(one),code:'TEST'}).bytes);
  expect(parts.has('word/media/t3-signature-reported.png')).toBe(true);expect(parts.has('word/media/t3-signature-approved.png')).toBe(false);
 });
 describe('Owner 2026-11-10: a template with a blank signature area gets a generated, equal-height signer block',()=>{
  const blank='<w:p><w:pPr/></w:p>';
  const body=(inner:string)=>writeArchive(new Map<string,Buffer>([['word/document.xml',Buffer.from(`<w:document><w:body>${tokens.map(t=>para(ph(t))).join('')}${inner}<w:sectPr/></w:body></w:document>`)],['word/_rels/document.xml.rels',Buffer.from('<Relationships></Relationships>')],['[Content_Types].xml',Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')]]));
  const run=(b:Buffer,rep:SignerSlot,app:SignerSlot)=>fillReport(b,'SINGLETON',values,{reported:rep,approved:app},{sha256:sha256(b),code:'TEST'});
  it('replaces the last five blank lines before "Report End" with a two-column block; both pictures have the same height',()=>{
   const b=body(blank.repeat(9)+para('Report End'));
   const out=run(b,slot(1200,500,1),slot(900,300,2)),parts=readArchive(out.bytes),xml=parts.get('word/document.xml')!.toString('utf8');
   expect(extents(xml).map(e=>e.split('x')[1])).toEqual([String(SIGNATURE_FRAME.cy),String(SIGNATURE_FRAME.cy)]);
   expect(xml).toContain('Reported by:  (Test Signer)');expect(xml).toContain('Approved by:  (Test Signer)');
   expect(xml).toContain('(Medical Technologist license no.12345)');expect(xml).toContain('Reported Date: 01-Jan-2026');expect(xml).toContain('Approved Date: 01-Jan-2026');
   expect((xml.match(/<w:p><w:pPr\/><\/w:p>/g)??[]).length).toBe(4);// 9 blank lines: 4 kept, 5 replaced
   expect(xml.indexOf('<w:tbl>')).toBeLessThan(xml.indexOf('Report End'));
   expect(parts.has('word/media/t3-signature-reported.png')).toBe(true);expect(parts.has('word/media/t3-signature-approved.png')).toBe(true);
   expect(parts.get('[Content_Types].xml')!.toString()).toContain('Extension="png"');
   expect(parts.get('word/_rels/document.xml.rels')!.toString()).toContain('rIdT3SigReported');
   expect(out.bindings.filter(x=>x.token==='signature.block').length).toBe(2);
  });
  it('a signer without a signature image still gets name, licence and date and no picture',()=>{
   const none:SignerSlot={name:'No Image',license:'999',date:'02-Feb-2026',signature:null};
   const out=run(body(blank.repeat(6)+para('Report End')),none,slot(300,100,2)),parts=readArchive(out.bytes);
   expect(extents(parts.get('word/document.xml')!.toString('utf8'))).toHaveLength(1);
   expect(parts.get('word/document.xml')!.toString('utf8')).toContain('Reported by:  (No Image)');
   expect(parts.has('word/media/t3-signature-reported.png')).toBe(false);expect(parts.has('word/media/t3-signature-approved.png')).toBe(true);
  });
  it('without "Report End" and without blank lines the block goes above the last paragraph of the last table cell',()=>{
   const b=body('<w:tbl><w:tr><w:tc><w:p><w:pPr/></w:p></w:tc></w:tr></w:tbl><w:p><w:pPr/></w:p>');
   const xml=readArchive(run(b,slot(300,100,1),slot(300,100,2)).bytes).get('word/document.xml')!.toString('utf8');
   expect(xml).toContain('Approved by:  (Test Signer)');expect(xml.indexOf('<w:tbl><w:tblPr>')).toBeGreaterThan(xml.indexOf('<w:tc>'));
  });
  it('a signer name too long for the cell is refused instead of overflowing',()=>{
   const long:SignerSlot={...slot(300,100,1),name:'X'.repeat(120)};
   expect(()=>run(body(blank.repeat(6)+para('Report End')),long,slot(300,100,2))).toThrow('SIGNER_NAME_TOO_LONG_FOR_TEMPLATE');
  });
 });
 it('still refuses a template without the "Reported by:" / "Approved by:" labels',()=>{
  const nolabel=writeArchive(new Map(readArchive(master)).set('word/document.xml',Buffer.from(documentXml.replace('Reported by: (Name)','Reported (Name)').replace('Approved by: (Name)','Approved (Name)'))));
  expect(()=>fillReport(nolabel,'SINGLETON',values,{reported:slot(300,100,1),approved:slot(300,100,2)},{sha256:sha256(nolabel),code:'TEST'})).toThrow(/DOCX_LICENSE_WITHOUT_SIGNER|DOCX_SIGNATURE_ROLE_UNRESOLVED/);
 });
 it('REPORT_SIGNATURE_MISSING when the stored signature media is not the signer image',()=>{
  const good=slot(300,100,1);let reads=0;const counting={...good,get signature(){reads++;return good.signature;}} as SignerSlot;
  fillReport(master,'SINGLETON',values,{reported:counting,approved:slot(300,100,2)},descriptor);const total=reads;reads=0;
  const bad={...good.signature!,bytes:Buffer.from('other')};
  const tampered={...good,get signature(){reads++;return reads===total?bad:good.signature;}} as SignerSlot;
  expect(()=>fillReport(master,'SINGLETON',values,{reported:tampered,approved:slot(300,100,2)},descriptor)).toThrow('REPORT_SIGNATURE_MISSING');
 });
});

// Ruling R11: a fit that cannot be proven safe never stops a report and never distorts: the picture keeps the template's frame and the reason is recorded.
describe('fillReport falls back to the template frame with evidence',()=>{
 const variant=(mut:(d:string)=>string)=>{const xml=documentXml.replace(drawing('rId5',1),mut(drawing('rId5',1)));return writeArchive(new Map(readArchive(master)).set('word/document.xml',Buffer.from(xml)));};
 const run=(m:Buffer)=>{const out=fillReport(m,'SINGLETON',values,{reported:slot(1200,100,1),approved:slot(100,400,2)},{sha256:sha256(m),code:'TEST'}),parts=readArchive(out.bytes);
  return {xml:parts.get('word/document.xml')!.toString('utf8'),parts,fit:out.bindings.filter(b=>b.token==='signature.fit').map(b=>b.value)};};
 const cases:[string,(d:string)=>string,string][]=[
  ['no wp:extent',d=>d.replace(/<wp:extent\b[^>]*\/>/,''),'SKIPPED:NO_EXTENT'],
  ['zero-size frame',d=>d.replace('<wp:extent cx="1800000"','<wp:extent cx="0"'),'SKIPPED:FRAME_SIZE_INVALID'],
  ['rotated picture',d=>d.replace('<a:xfrm>','<a:xfrm rot="5400000">'),'SKIPPED:ROTATED'],
  ['simplePos',d=>d.replace('<wp:anchor behindDoc="1">','<wp:anchor behindDoc="1" simplePos="1">'),'SKIPPED:SIMPLE_POS'],
  ['aligned position',d=>d.replace('<wp:posOffset>1000000</wp:posOffset>','<wp:align>left</wp:align>'),'SKIPPED:ALIGNED_POSITION'],
  ['two pictures in one drawing',d=>d.replace('</a:graphicData>',pic('rId5')+'</a:graphicData>'),'SKIPPED:NOT_ONE_PICTURE'],
  ['non-picture graphic',d=>d.replace('uri="http://schemas.openxmlformats.org/drawingml/2006/picture"','uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"'),'SKIPPED:NOT_PICTURE_GRAPHIC'],
 ];
 it.each(cases)('%s: no throw, template frame kept, evidence recorded, signer image still used',(_n,mut,expected)=>{
  const r=run(variant(mut));
  expect(r.fit[0]).toBe(expected);expect(r.fit.at(-1)).toBe('FITTED');
  expect(r.parts.get('word/media/t3-signature-reported.png')!.length).toBeGreaterThan(0);expect(r.xml).toContain('rIdT3SigReported');
  expect(r.xml).not.toContain('rId5"');
  expect(extents(r.xml).at(-1)).toBe('150000x600000');
 });
 it('a wps/wpg group with a text token inside: no DOCX_EDIT_OVERLAP, text still filled, fit skipped',()=>{
  const m=variant(d=>d.replace('<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">','<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"><wpg:wgp><wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>'+ph('remarks')+'</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>').replace('</a:graphicData>','</wpg:wgp></a:graphicData>'));
  const r=run(m);
  expect(r.fit[0]).toBe('SKIPPED:GROUP_OR_SHAPE');expect(r.xml).not.toContain('remarks}');expect(r.xml).toContain('rIdT3SigReported');
 });
});

describe('decideSignerProfile layout review gate',()=>{
 const admin={id:'00000000-0000-4000-8000-000000000001',roles:['APP_ADMIN'],unitIds:[],permissions:[]} as unknown as Staff;
 const nobody={id:'00000000-0000-4000-8000-000000000003',roles:['LAB_STAFF'],unitIds:[],permissions:[]} as unknown as Staff;
 const db={query:async()=>{throw new Error('NO_DB');}} as never;
 const input={profileId:'00000000-0000-4000-8000-000000000002',decision:'VERIFY',reason:'ตรวจตัวตนและลายเซ็นแล้ว'};
 it('VERIFY without layoutReviewed (or the explicit unavailable flag) is refused before any write',async()=>{
  await expect(decideSignerProfile(db,admin,input)).rejects.toThrow('SIGNER_LAYOUT_REVIEW_REQUIRED');
  await expect(decideSignerProfile(db,admin,{...input,layoutReviewed:false})).rejects.toThrow('SIGNER_LAYOUT_REVIEW_REQUIRED');
 });
 it('VERIFY passes the gate with layoutReviewed or previewUnavailable; REVOKE never needs it',async()=>{
  await expect(decideSignerProfile(db,admin,{...input,layoutReviewed:true})).rejects.toThrow('NO_DB');
  await expect(decideSignerProfile(db,admin,{...input,previewUnavailable:true},{previewPossible:async()=>false})).rejects.toThrow('NO_DB');
  await expect(decideSignerProfile(db,admin,{...input,decision:'REVOKE'})).rejects.toThrow('NO_DB');
 });
 it('a non-administrator gets FORBIDDEN (not a 422 hint) before the review gate',async()=>{
  await expect(decideSignerProfile(db,nobody,input)).rejects.toThrow('FORBIDDEN');
 });
 it('could-not-preview is refused unless previews really are impossible on this machine',async()=>{
  await expect(decideSignerProfile(db,admin,{...input,previewUnavailable:true})).rejects.toThrow('SIGNER_PREVIEW_AVAILABLE');
  await expect(decideSignerProfile(db,admin,{...input,previewUnavailable:true},{previewPossible:async()=>true})).rejects.toThrow('SIGNER_PREVIEW_AVAILABLE');
 });
});

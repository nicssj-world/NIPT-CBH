import {describe,it,expect} from 'vitest';
import {fillReport,TOKENS,DocxError,type SignerSlot,type ReportValues} from '../../packages/readygen/docx';
import {readArchive,writeArchive,sha256} from '../../packages/workbook/archive';
import {signaturePng} from '../../tools/task3-uat/signature';
import {decideSignerProfile} from '../../packages/readygen/signers';
import type {Staff} from '../../packages/lab/core';

// Synthetic one-page master (NOT the Owner's file): same structure the real masters use for signatures — an anchored picture
// before each "Reported by:" / "Approved by:" label, text-token paragraphs, licence and QC lines.
const ph=(t:string)=>'$'+'{'+t+'}';
const pic=(rid:string)=>`<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="s"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:srcRect l="1000"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1800000" cy="600000"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic>`;
const drawing=(rid:string,id:number)=>`<w:p><w:r><w:drawing><wp:anchor behindDoc="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>1000000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>-50000</wp:posOffset></wp:positionV><wp:extent cx="1800000" cy="600000"/><wp:wrapNone/><wp:docPr id="${id}" name="P${id}"/><a:graphic><a:graphicData uri="u">${pic(rid)}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;
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
  expect(out.bindings.filter(b=>b.token==='signature.frame').map(b=>b.value)).toEqual(['1800000x150000','150000x600000']);
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
 it('refuses a master without both signature pictures',()=>{
  const bad=writeArchive(new Map(readArchive(master)).set('word/document.xml',Buffer.from(documentXml.replace(drawing('rId6',2),''))));
  expect(()=>fillReport(bad,'SINGLETON',values,{reported:slot(300,100,1),approved:slot(300,100,2)},{sha256:sha256(bad),code:'TEST'})).toThrow(DocxError);
 });
});

describe('decideSignerProfile layout review gate',()=>{
 const admin={id:'00000000-0000-4000-8000-000000000001',roles:[]} as unknown as Staff;
 const db={query:async()=>{throw new Error('NO_DB');}} as never;
 const input={profileId:'00000000-0000-4000-8000-000000000002',decision:'VERIFY',reason:'ตรวจตัวตนและลายเซ็นแล้ว'};
 it('VERIFY without layoutReviewed (or the explicit unavailable flag) is refused before any write',async()=>{
  await expect(decideSignerProfile(db,admin,input)).rejects.toThrow('SIGNER_LAYOUT_REVIEW_REQUIRED');
  await expect(decideSignerProfile(db,admin,{...input,layoutReviewed:false})).rejects.toThrow('SIGNER_LAYOUT_REVIEW_REQUIRED');
 });
 it('VERIFY passes the gate with layoutReviewed or previewUnavailable; REVOKE never needs it',async()=>{
  await expect(decideSignerProfile(db,admin,{...input,layoutReviewed:true})).rejects.toThrow('NO_DB');
  await expect(decideSignerProfile(db,admin,{...input,previewUnavailable:true})).rejects.toThrow('NO_DB');
  await expect(decideSignerProfile(db,admin,{...input,decision:'REVOKE'})).rejects.toThrow('NO_DB');
 });
});

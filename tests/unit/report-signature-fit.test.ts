import {describe,it,expect} from 'vitest';
import {fitSignature,fitDrawingXml} from '../../packages/readygen/signature-fit';
import {signatureImage} from '../../packages/readygen/signers';
import {signaturePng} from '../../tools/task3-uat/signature';

const frame={cx:1800000,cy:600000};
describe('fitSignature',()=>{
 it('wide image: full width, centred vertically',()=>{
  expect(fitSignature(frame,{width:1200,height:100})).toEqual({cx:1800000,cy:150000,offsetX:0,offsetY:225000});
 });
 it('tall image: full height, centred horizontally',()=>{
  expect(fitSignature(frame,{width:100,height:400})).toEqual({cx:150000,cy:600000,offsetX:825000,offsetY:0});
 });
 it('image with the frame aspect ratio fills the frame',()=>{
  expect(fitSignature(frame,{width:300,height:100})).toEqual({cx:1800000,cy:600000,offsetX:0,offsetY:0});
 });
 it('never exceeds the frame and keeps the ratio within 1 EMU',()=>{
  for(const [w,h] of [[240,80],[77,13],[4000,16],[40,2000],[333,331]] as const){
   const f=fitSignature(frame,{width:w,height:h});
   expect(f.cx).toBeLessThanOrEqual(frame.cx);expect(f.cy).toBeLessThanOrEqual(frame.cy);
   expect(f.cx===frame.cx||f.cy===frame.cy).toBe(true);
   expect(Math.abs(f.cx/f.cy-w/h)).toBeLessThan(1/Math.min(f.cx,f.cy)*(w/h+1)+1e-9);
   expect(f.offsetX*2+f.cx).toBeGreaterThanOrEqual(frame.cx-1);expect(f.offsetX*2+f.cx).toBeLessThanOrEqual(frame.cx+1);
   expect(f.offsetY*2+f.cy).toBeGreaterThanOrEqual(frame.cy-1);expect(f.offsetY*2+f.cy).toBeLessThanOrEqual(frame.cy+1);
  }
 });
});

const pic=(w:number,h:number)=>`<pic:pic xmlns:pic="p"><pic:nvPicPr><pic:cNvPr id="1" name="sig"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdX"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`;
const anchor=`<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="5" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>1000000</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>-50000</wp:posOffset></wp:positionV><wp:extent cx="1800000" cy="600000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="7" name="Picture 7"/><a:graphic><a:graphicData uri="u">${pic(1800000,600000)}</a:graphicData></a:graphic></wp:anchor></w:drawing>`;
const inline=`<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1800000" cy="600000"/><wp:docPr id="8" name="Picture 8"/><a:graphic><a:graphicData uri="u">${pic(1800000,600000)}</a:graphicData></a:graphic></wp:inline></w:drawing>`;

describe('fitDrawingXml',()=>{
 it('anchor: resizes extent and a:ext, adds the centring offset to posOffset, leaves the rest byte-identical',()=>{
  const out=fitDrawingXml(anchor,{width:1200,height:100});
  const expected=anchor.replaceAll('cy="600000"','cy="150000"').replace('<wp:posOffset>-50000</wp:posOffset>','<wp:posOffset>175000</wp:posOffset>');
  expect(out).toBe(expected);
  expect((out.match(/cx="1800000" cy="150000"/g)??[]).length).toBe(2);
  expect(out).toContain('<wp:posOffset>1000000</wp:posOffset>');
 });
 it('anchor, tall image: horizontal offset added',()=>{
  const out=fitDrawingXml(anchor,{width:100,height:400});
  expect(out).toContain('<wp:posOffset>1825000</wp:posOffset>');expect(out).toContain('<wp:posOffset>-50000</wp:posOffset>');
  expect((out.match(/cx="150000" cy="600000"/g)??[]).length).toBe(2);
 });
 it('inline: sizes change, nothing is moved',()=>{
  const out=fitDrawingXml(inline,{width:1200,height:100});
  expect(out).toBe(inline.replaceAll('cy="600000"','cy="150000"'));
 });
 it('frame-shaped image leaves the drawing identical',()=>{
  expect(fitDrawingXml(anchor,{width:300,height:100})).toBe(anchor);
  expect(fitDrawingXml(inline,{width:300,height:100})).toBe(inline);
 });
 it('aligned (not offset) anchors keep their alignment; drawing without extent is unchanged',()=>{
  const aligned=anchor.replace('<wp:posOffset>1000000</wp:posOffset>','<wp:align>center</wp:align>');
  expect(fitDrawingXml(aligned,{width:100,height:400})).toContain('<wp:align>center</wp:align>');
  expect(fitDrawingXml('<w:drawing/>',{width:1,height:1})).toBe('<w:drawing/>');
 });
});

const chunk=(type:string,data:Buffer)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);return Buffer.concat([len,Buffer.from(type),data,Buffer.alloc(4)]);};
const header=(w:number,h:number,colorType:number)=>{const b=Buffer.alloc(13);b.writeUInt32BE(w,0);b.writeUInt32BE(h,4);b[8]=8;b[9]=colorType;return b;};
const png=(colorType:number,extra:Buffer[]=[])=>Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk('IHDR',header(120,40,colorType)),...extra,chunk('IDAT',Buffer.from([0])),chunk('IEND',Buffer.alloc(0))]);
describe('signatureImage opaque',()=>{
 it('PNG with alpha is not opaque',()=>{expect(signatureImage(png(6))).toMatchObject({media:'image/png',width:120,height:40,opaque:false});expect(signatureImage(signaturePng(1)).opaque).toBe(false);});
 it('grey+alpha is not opaque',()=>expect(signatureImage(png(4)).opaque).toBe(false));
 it('RGB or grey without tRNS is opaque',()=>{expect(signatureImage(png(2)).opaque).toBe(true);expect(signatureImage(png(0)).opaque).toBe(true);});
 it('RGB with tRNS is not opaque',()=>expect(signatureImage(png(2,[chunk('tRNS',Buffer.from([0,0,0,0,0,0]))])).opaque).toBe(false));
 it('palette PNG is treated as not opaque (may carry transparency)',()=>expect(signatureImage(png(3,[chunk('PLTE',Buffer.alloc(3))])).opaque).toBe(false));
 it('JPEG is opaque',()=>{
  const jpeg=Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,0x00,0x40,0x00,0x90,0x03,0x01,0x22,0x00,0x02,0x11,0x01,0x03,0x11,0x01,0xff,0xd9]);
  expect(signatureImage(jpeg)).toEqual({media:'image/jpeg',width:144,height:64,opaque:true});
 });
});

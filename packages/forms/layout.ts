// Field positions for layout BM17-2026-10, measured from the text and drawn boxes of the two supplied DCC PDFs
// (request 595.2 x 841.92 pt, consent 594.96 x 842.04 pt). Coordinates are PDF points from the bottom-left corner:
// text `y` is the baseline, check `y` is the centre of the printed box. Nothing here edits or moves template content.
export type OverlayItem=
 |{kind:'text';x:number;y:number;w:number;size:number;text:string;align?:'left'|'center';lines?:number}
 |{kind:'digit';x:number;y:number;text:string}
 |{kind:'check';x:number;y:number};
export type OverlayPage={width:number;height:number;items:OverlayItem[];banner:string;watermark:string};
export type Answer='Yes'|'No'|null;
export type Digits8=[string,string,string,string,string,string,string,string]|null; // DDMMYYYY (BE)
export type RequestFields={
 name:string|null;hn:string|null;nationalId:string|null;dob:Digits8;age:string|null;weight:string|null;height:string|null;bmi:string|null;
 entitlement:'NHSO'|'SELF_PAY'|null;reason:string|null;facility:string|null;doctor:string|null;coordinatorPhone:string|null;email:string|null;
 ultrasound:Digits8;edd:Digits8;ga:{w:string;d:string}|null;pregnancyType:'Singleton'|'Twins'|null;vanishing:Answer;vanishingGa:string|null;drawAfter8:boolean;
 art:Answer;pregnancyNumber:string|null;gpa:{gravida:string|null;para:string|null;abortion:string|null}|null;history:[Answer,Answer,Answer,Answer,Answer,Answer,Answer];priorMethod:string|null;priorResult:string|null;item8:string|null;
 fetalSex:'Want'|'DoNotWant'|null;draw:{date:Digits8;time:string|null};receive:{condition:'ACCEPTABLE'|'REJECTED'|null;reason:string|null;date:string|null;time:string|null};ackA:boolean;ackB:boolean;
};
export type ConsentFields={patientName:string|null;doctor:string|null;acknowledged:boolean[];decision:'Granted'|'Declined'|null;patientSignedDate:string|null;documentCreatedDate?:string|null};

const text=(x:number,y:number,w:number,value:string|null,size=9,extra:Partial<{align:'left'|'center';lines:number}>={}):OverlayItem[]=>value?[{kind:'text',x,y,w,size,text:value,...extra}]:[];
const digits=(xs:number[],y:number,d:Digits8):OverlayItem[]=>d?xs.map((x,i)=>({kind:'digit' as const,x,y,text:d[i]})).filter(i=>i.text):[];
const check=(on:boolean,x:number,y:number):OverlayItem[]=>on?[{kind:'check',x,y}]:[];
const DATE_A=[213.5,229.65,256.85,273.65,300.4,318.2,333.8,349.3];

export function requestItems(f:RequestFields):OverlayItem[]{
 const h=f.history,yes=[223.85,223.85,223.85,224.25,224.25,224.45,224.25],no=[251.15,251.35,251.15,251.55,251.55,251.75,251.55],rows=[332.4,312.9,292.9,273.1,254.7,217.5,198.3];
 return [
  ...text(36,655,152,f.name,9.5,{lines:2}),...text(208,655,152,f.hn,9.5),...text(36,609.5,152,f.nationalId,9.5),...digits(DATE_A,623.4,f.dob),
  ...text(193.5,580.5,30,f.age,8.5,{align:'center'}),...text(234,580.5,38,f.weight,8.5,{align:'center'}),...text(282,580.5,40,f.height,8.5,{align:'center'}),...text(332,580.5,30,f.bmi,8.5,{align:'center'}),
  ...check(f.entitlement==='NHSO',41.9,584.5),...check(f.entitlement==='SELF_PAY',113.1,584.5),
  ...text(37,543.5,318,f.reason,9,{lines:2}),
  ...text(392,653,150,f.facility,9.5,{lines:2}),...text(392,608.5,150,f.doctor,9.5,{lines:2}),...text(392,563.5,150,f.coordinatorPhone,9,{lines:2}),...text(394,529,148,f.email,9),
  ...digits([43.25,59.35,86.45,103.35,130.2,147.9,163.5,179.1],486.8,f.ultrasound),...digits([42.65,58.65,85.85,102.75,129.5,147.2,162.8,178.4],448.3,f.edd),
  ...(f.ga?[42.75,58.25,83.75].map((x,i)=>({kind:'digit' as const,x,y:408.8,text:(f.ga!.w.padStart(2,'0')+f.ga!.d)[i]})):[]),
  ...check(f.pregnancyType==='Singleton',215,507.6),...check(f.pregnancyType==='Twins',276.9,507.6),
  ...check(f.vanishing==='No',214.4,469.5),...check(f.vanishing==='Yes',253.75,469.5),...text(341,467,30,f.vanishingGa,8),...check(f.drawAfter8,253.1,438.25),
  ...check(f.art==='Yes',53.1,375.75),...check(f.art==='No',79.4,375.75),...text(313,388.5,52,f.pregnancyNumber,9,{align:'center'}),...gpaItems(f.gpa),
  ...h.flatMap((a,i)=>[...check(a==='Yes',yes[i],rows[i]),...check(a==='No',no[i],rows[i])]),
  ...text(72,177.5,88,f.priorMethod,8),...text(194,177.5,82,f.priorResult,8),...text(66,144,205,f.item8,8),
  ...check(f.fetalSex==='Want',320.6,317),...check(f.fetalSex==='DoNotWant',386.25,317),
  ...digits([396.05,412.15,439.25,456.15,480.8,498.5,514.1,529.8],431.1,f.draw.date),...text(434,408.5,104,f.draw.time,9),
  ...check(f.receive.condition==='ACCEPTABLE',323.85,273.9),...check(f.receive.condition==='REJECTED',371.35,273.9),...text(433,271,112,f.receive.reason,7.5),
  ...text(376,250,82,f.receive.date,8.5),...text(481,250,64,f.receive.time,8.5),
  ...check(f.ackA,44.45,102.2),...check(f.ackB,44.45,60.5),
 ];
}
function gpaItems(gpa:RequestFields['gpa']):OverlayItem[]{
 if(!gpa)return [];
 const items:OverlayItem[]=[];
 const entries=[['G',gpa.gravida,233,245],['P',gpa.para,266,278],['A',gpa.abortion,299,311]] as const;
 let x=233;
 for(const [label,value,labelX,digitX] of entries){if(value===null)continue;const actualX=Math.max(x,labelX);items.push({kind:'text',x:actualX,y:375,w:12,size:8.5,text:label});items.push({kind:'text',x:Math.max(actualX+10,digitX),y:371,w:15,size:6.5,text:value});x=Math.max(actualX+25,digitX+15)+7;}
 return items;
}
const CLAUSE_ROWS=[687.8,657.9,628.1,598.1,568.3,519.4,472.5,442.6,412.7,382.9,338.3,323.1];
/** Owner-authorized rendered signature block; installed original remains hash-identical. */
export const CONSENT_SIGNATURE_MASKS=[{x:38,y:106,width:517,height:109}];
export const CONSENT_SIGNATURE_LAYOUT={patient:{x:55,y:157,width:230,height:24},doctor:{x:325,y:157,width:220,height:24}};
export function consentItems(f:ConsentFields):OverlayItem[]{
 return [
  ...CLAUSE_ROWS.flatMap((y,i)=>check(f.acknowledged[i]===true,536,y+3.5)),
  ...check(f.decision==='Granted',373.35,247),...check(f.decision==='Declined',373.35,228.9),
  ...text(55,189,230,'ผู้รับบริการ / ผู้แทนโดยชอบธรรม',9,{align:'center'}),...text(325,189,220,'แพทย์ผู้สั่งตรวจ',9,{align:'center'}),
  ...text(55,128,230,f.patientName,10,{align:'center',lines:2}),...text(325,128,220,f.doctor,10,{align:'center',lines:2}),
  ...text(55,112,230,f.patientSignedDate?`วันที่ ${f.patientSignedDate}`:'วันที่',9,{align:'center'}),
  ...text(325,112,220,f.documentCreatedDate?`วันที่จัดทำเอกสาร ${f.documentCreatedDate}`:'วันที่จัดทำเอกสาร',9,{align:'center'}),
 ];
}
export const REQUEST_PAGE={width:595.2,height:841.92},CONSENT_PAGE={width:594.96,height:842.04};

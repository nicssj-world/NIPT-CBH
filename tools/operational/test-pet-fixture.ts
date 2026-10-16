import iconv from 'iconv-lite';

/** Test-only PET transport shared with the operational positive-journey contract. */
export function operationalTestPetBytes(input:{ln:string;hn:string;day:string;time?:string}) {
 const {ln,hn,day,time='100000'}=input;
 if(!/^\d{12}$/.test(ln)||!(/^\d{8}\/\d{2}$/.test(hn))||! /^\d{8}$/.test(day)||! /^\d{6}$/.test(time))throw Error('LOCAL_UAT_PET_FIXTURE_INVALID');
 const patient=Array<string>(35).fill('');
 Object.assign(patient,{0:'P',1:'1',2:ln,3:hn,5:'LOCAL TEST^^TEST',7:'19960331',8:'F',21:day+time,23:day+'070000^'+day+'070000',33:'LOCAL UAT^TEST'});
 const order=Array<string>(29).fill('');
 Object.assign(order,{0:'O',1:'1',4:'^^^70096^B^0',14:day+'070000',18:'7'});
 return Buffer.from(iconv.encode(['H',patient.join('|'),order.join('|'),'L|1|N'].join('\r\n'),'windows-874'));
}

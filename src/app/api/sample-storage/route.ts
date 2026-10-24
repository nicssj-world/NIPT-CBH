import {NextResponse,type NextRequest} from 'next/server';
import {withTransaction} from '../../../../packages/db/connection';
import {storageSearch,storageCommand,storageLabel,storageSampleLabel} from '../../../../packages/lab/sample-storage';
import {readJson} from '../../../server/http';
import {p5hError,p5hMutation,noStore} from '../../../server/p5h';

export async function POST(request:NextRequest){
 return p5hMutation(request,'LAB_STORAGE',async user=>{
  const body=await readJson(request);
  if(body.action==='search'){
   const query=Object.fromEntries(Object.entries(body).filter(([key])=>key!=='action'));
   return NextResponse.json(await withTransaction(db=>storageSearch(db,user,query)),{headers:noStore});
  }
  if(body.action==='printLabel'){
   const pdf=await withTransaction(db=>storageLabel(db,user,typeof body.boxId==='string'?body.boxId:''));
   return new NextResponse(new Uint8Array(pdf),{headers:{...noStore,'Content-Type':'application/pdf','Content-Disposition':'inline; filename="sample-storage-box-label.pdf"'}});
  }
  if(body.action==='printSampleLabel'){
   const pdf=await withTransaction(db=>storageSampleLabel(db,user,{roundId:typeof body.roundId==='string'?body.roundId:'',storageType:body.storageType}));
   return new NextResponse(new Uint8Array(pdf),{headers:{...noStore,'Content-Type':'application/pdf','Content-Disposition':'inline; filename="sample-storage-specimen-label.pdf"'}});
  }
  try{return NextResponse.json(await withTransaction(db=>storageCommand(db,user,body)),{headers:noStore});}
  catch(error){return p5hError(error);}
 });
}

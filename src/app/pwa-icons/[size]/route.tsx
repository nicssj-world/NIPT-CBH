import {ImageResponse} from 'next/og';
import type {NextRequest} from 'next/server';
/** Icons are public, generated locally and never contain PHI or credentials. */
export const runtime='nodejs';
export async function GET(_request:NextRequest,{params}:{params:Promise<{size:string}>}){
 const {size}=await params;
 if(size!=='192'&&size!=='512')return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
 const n=Number(size);
 return new ImageResponse(
  <div style={{height:'100%',width:'100%',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:'#123653',color:'#fff',fontFamily:'Arial,sans-serif'}}>
   <div style={{width:Math.round(n*.65),height:Math.round(n*.65),border:`${Math.max(4,Math.round(n*.025))}px solid #a9e8ef`,borderRadius:Math.round(n*.16),display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:Math.round(n*.022)}}>
    <div style={{fontSize:Math.round(n*.17),fontWeight:800,letterSpacing:'-0.03em'}}>NIPT</div>
    <div style={{fontSize:Math.round(n*.105),fontWeight:800,letterSpacing:'0.08em'}}>CBH</div>
   </div>
  </div>,
  {width:n,height:n,headers:{'Cache-Control':'public, max-age=31536000, immutable'}}
 );
}

"use client";
/* eslint-disable @next/next/no-img-element -- photos come from an authenticated endpoint; next/image would proxy them and inject inline styles the CSP blocks */
import {useState} from "react";
import {fileUrl} from "./photo-client";
/** Gallery thumbnail with a reserved 4:3 box; a store that is offline shows a labelled placeholder, not a broken image. */
export function Thumb({id,hasThumb,fallback}:{id:string;hasThumb:boolean;fallback:string}){
 const [failed,setFailed]=useState(false);
 if(!hasThumb)return <span className="photo-placeholder">{fallback}</span>;
 if(failed)return <span className="photo-placeholder failed">เปิดภาพย่อไม่ได้ขณะนี้ — ที่เก็บภาพอาจไม่พร้อม</span>;
 return <img src={fileUrl(id,"thumb")} alt="" loading="lazy" decoding="async" width={480} height={360} onError={()=>setFailed(true)}/>;
}

'use client';
import {useEffect,useState} from 'react';
export function ArchiveStatus({versionId}:{versionId:string}){
 const [state,setState]=useState<string|null>(null);
 useEffect(()=>{let active=true;void fetch(`/api/p5/results/${encodeURIComponent(versionId)}/archive`,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{if(active)setState(data.state);}).catch(()=>{if(active)setState('UNKNOWN');});return()=>{active=false;};},[versionId]);
 if(!state)return null;
 const labels:Record<string,string>={PENDING:'รอจัดเก็บ',ARCHIVED:'จัดเก็บและตรวจสอบแล้ว',FAILED:'จัดเก็บไม่สำเร็จ — แจ้งผู้ดูแลระบบ',UNKNOWN:'ตรวจสอบสถานะไม่ได้'};
 return <p>สถานะสำเนา NAS: {labels[state]??'ตรวจสอบสถานะไม่ได้'} · แยกจากการรับรองผลและการส่ง HIS</p>;
}

"use client";
import {useState} from 'react';
export function LocalAlertTest(){const [show,setShow]=useState(false);return <div><button className="button secondary" onClick={()=>setShow(!show)}>ทดสอบ Alert ในหน้านี้</button>{show&&<p className="notice" role="alert">LOCAL TEST · WORKER_OFFLINE / QUEUE_BACKLOG — เป็นการสาธิตใน Browser ไม่ใช่สถานะบริการจริง ไม่มีการส่งภายนอก</p>}</div>;}

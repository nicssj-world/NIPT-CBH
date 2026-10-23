'use client';
import {useState} from 'react';
import {labApi,failureText,bkk} from '../p4/lab-api';
import {PdfPreviewButton} from '../shared/pdf-preview';
export function HistoricalRevisions({draftId}:{draftId:string}){
 const [rows,setRows]=useState<{version:number;created_at:string;reason:string;actor:string;pdf_file_id:string|null;batch_id:string}[]>([]),[error,setError]=useState('');
 return <details onToggle={e=>{if(e.currentTarget.open)void labApi<typeof rows>(`/api/p5h/rows/${draftId}/revisions`).then(setRows).catch(e=>setError(failureText(e)));}}><summary>ประวัติแก้ไข</summary>{error&&<p role="alert">{error}</p>}<ol>{rows.map(r=><li key={r.version}>ฉบับ {r.version} · {r.actor} · {bkk(r.created_at)} · {r.reason}{r.pdf_file_id&&<PdfPreviewButton title={`PDF ฉบับ ${r.version}`} src={`/api/p5h/batches/${r.batch_id}/files/${r.pdf_file_id}`}/>}</li>)}</ol></details>;
}

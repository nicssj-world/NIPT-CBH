'use client';
import {forwardRef,useRef,useState,type InputHTMLAttributes} from 'react';
/** LAB-UAT-031: selection only; existing submit/limits/authorization remain at each caller. */
/** `compact` (OWNER-LAB-053, Run Photo): no helper sentence and no filename list; drag/drop, multi-select and errors stay. */
export const FileDropInput=forwardRef<HTMLInputElement,InputHTMLAttributes<HTMLInputElement>&{compact?:boolean}>(function FileDropInput({compact,...props},ref){
 const own=useRef<HTMLInputElement|null>(null),[active,setActive]=useState(false),[names,setNames]=useState<string[]>([]),[error,setError]=useState('');
 const accepts=(f:File)=>!props.accept||props.accept.split(',').some(rule=>{const r=rule.trim().toLowerCase();return r.startsWith('.')?f.name.toLowerCase().endsWith(r):r.endsWith('/*')?f.type.startsWith(r.slice(0,-1)):f.type===r;});
 return <div className={`file-drop${active?' drag-active':''}`} onDragOver={e=>{e.preventDefault();if(!props.disabled)setActive(true);}} onDragLeave={()=>setActive(false)} onDrop={e=>{
  e.preventDefault();setActive(false);if(props.disabled)return;const files=Array.from(e.dataTransfer.files);
  if(!props.multiple&&files.length>1){setError('เลือกได้ครั้งละ 1 ไฟล์');return;}
  if(files.some(f=>!accepts(f))){setError(`ประเภทไฟล์ไม่รองรับ (${props.accept})`);return;}
  if(own.current){const transfer=new DataTransfer();files.forEach(f=>transfer.items.add(f));own.current.files=transfer.files;own.current.dispatchEvent(new Event('change',{bubbles:true}));setNames(files.map(f=>f.name));setError('');}
 }}>
  <input {...props} type="file" ref={node=>{own.current=node;if(typeof ref==='function')ref(node);else if(ref)ref.current=node;}} onChange={e=>{setNames(Array.from(e.target.files??[]).map(f=>f.name));setError('');props.onChange?.(e);}}/>
  {!compact&&<p className="hint">ลากไฟล์มาวาง หรือเลือกไฟล์จากเครื่อง</p>}{!compact&&names.length>0&&<><p className="file-names">{names.length} ไฟล์ · {names.join(', ')}</p><button type="button" className="button secondary small" disabled={props.disabled} onClick={()=>{if(own.current){own.current.value='';own.current.dispatchEvent(new Event('change',{bubbles:true}));}setNames([]);}}>ล้างรายการ</button></>}{error&&<p role="alert" className="form-error">{error}</p>}
 </div>;
});

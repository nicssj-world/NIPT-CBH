"use client";
import {useEffect,useId,useRef,useState,type KeyboardEvent} from "react";

// Selection always commits a doctor version ID from the existing registry, never free text.
export function DoctorCombobox({id,value,options,disabled=false,onChange,"data-field":dataField,"aria-describedby":describedBy,"aria-invalid":invalid,"aria-required":required}:{
 id:string;value:string;options:readonly (readonly [string,string])[];disabled?:boolean;
 onChange:(id:string|null)=>void;"data-field"?:string;"aria-describedby"?:string;
 "aria-invalid"?:boolean;"aria-required"?:boolean;
}){
 const listId=useId(),input=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false),[query,setQuery]=useState(""),[active,setActive]=useState(0);
 const selected=options.find(([key])=>key===value);
 const normalize=(v:string)=>v.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g,"");
 const matches=options.filter(([,name])=>normalize(name).includes(normalize(query)));
 useEffect(()=>{if(open){const option=list.current?.children.item(active);if(option instanceof HTMLElement)option.scrollIntoView({block:"nearest"});}},[active,open,query]);
 const choose=(key:string)=>{onChange(key);setOpen(false);setQuery("");setActive(0);};
 const keyDown=(e:KeyboardEvent<HTMLInputElement>)=>{
  if(e.key==="Escape"){if(open){e.preventDefault();setOpen(false);setQuery("");}return;}
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){
   e.preventDefault();
   if(!open){setQuery("");setActive(0);setOpen(true);return;}
   setActive(current=>Math.max(0,Math.min(matches.length-1,current+(e.key==="ArrowDown"?1:-1))));
  }else if(e.key==="Enter"&&open){
   e.preventDefault();if(matches[active])choose(matches[active][0]);
  }else if(e.key==="Tab"){setOpen(false);setQuery("");}
 };
 return <div className="doctor-combobox" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)){setOpen(false);setQuery("");}}}>
  <div className="doctor-combobox-control">
   <input ref={input} id={id} data-field={dataField} role="combobox" type="text" autoComplete="off"
    aria-autocomplete="list" aria-expanded={open&&!disabled} aria-controls={open?listId:undefined}
    aria-activedescendant={open&&matches[active]?listId+"-option-"+active:undefined}
    aria-describedby={describedBy} aria-invalid={invalid} aria-required={required}
    disabled={disabled} placeholder={disabled?"กำลังโหลดรายชื่อแพทย์…":"พิมพ์ค้นหาและเลือกแพทย์"}
    value={open?query:selected?.[1]??""}
    onFocus={()=>{if(!disabled){setQuery("");setActive(0);setOpen(true);}}}
    onChange={e=>{setQuery(e.target.value);setActive(0);setOpen(true);}}
    onKeyDown={keyDown}/>
   <button type="button" tabIndex={-1} className="doctor-combobox-toggle"
    aria-label={open?"ปิดรายชื่อแพทย์":"เปิดรายชื่อแพทย์"}
    disabled={disabled} onMouseDown={e=>e.preventDefault()}
    onClick={()=>{if(open){setOpen(false);setQuery("");}else{input.current?.focus();setQuery("");setActive(0);setOpen(true);}}}>
    <span aria-hidden="true">⌄</span>
   </button>
  </div>
  {open&&!disabled&&<div ref={list} id={listId} className="doctor-combobox-options" role="listbox" aria-label="รายชื่อแพทย์ผู้สั่งตรวจ">
   {matches.length===0?<p className="doctor-combobox-empty" role="status">ไม่พบแพทย์ในทะเบียน</p>:
    matches.map(([key,name],index)=><button key={key} type="button"
     id={listId+"-option-"+index} role="option" aria-selected={key===value}
     className={"doctor-combobox-option"+(index===active?" is-active":"")}
     onMouseDown={e=>e.preventDefault()} onClick={()=>choose(key)}>
      {name}{key===value&&<span aria-hidden="true"> ✓</span>}
     </button>)}
  </div>}
 </div>;
}

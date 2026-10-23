'use client';
import {useEffect} from 'react';
/** LAB-UAT-019/024: preserve browser/native dropdown and textarea behavior. */
export function InputSafety(){
 useEffect(()=>{
  const wheel=(e:WheelEvent)=>{if(e.target instanceof HTMLInputElement&&e.target.type==='number'&&document.activeElement===e.target)e.preventDefault();};
  const enter=(e:KeyboardEvent)=>{
   if(e.key!=='Enter'||e.isComposing||e.ctrlKey||e.altKey||e.metaKey||!(e.target instanceof HTMLInputElement)||!['number','text','date','datetime-local'].includes(e.target.type))return;
   const scope=e.target.closest('[data-enter-navigation]');if(!scope)return;
   e.preventDefault();
   const inputs=Array.from(scope.querySelectorAll<HTMLInputElement>('input')).filter(i=>!i.disabled&&!i.readOnly&&['number','text','date','datetime-local'].includes(i.type)&&i.getClientRects().length>0);
   const index=inputs.indexOf(e.target),next=inputs[index+(e.shiftKey?-1:1)];
   if(next){next.focus();try{next.select();}catch{ /* Date inputs do not support selection. */ }}
   else if(!e.shiftKey)scope.querySelector<HTMLButtonElement>('[data-worksheet-save]')?.focus();
  };
  document.addEventListener('wheel',wheel,{passive:false,capture:true});document.addEventListener('keydown',enter);
  return()=>{document.removeEventListener('wheel',wheel,true);document.removeEventListener('keydown',enter);};
 },[]);return null;
}

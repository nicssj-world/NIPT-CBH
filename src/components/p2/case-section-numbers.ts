"use client";
import {useEffect,type RefObject} from "react";

/**
 * Case page section numbers (Owner 2026-11-12): count only the sections that are actually shown, in their VISUAL order
 * (CSS `order` per stage, see anc-workspace.css), so a section that renders nothing (e.g. no NIPT result yet) leaves no gap.
 * The number is written to data-n on the section's title (h2 / result title / summary), because CSS attr() reads the element
 * that owns the ::before; case-sections.css draws it with content:attr(data-n).
 * The NIPT result panel loads on its own, so the numbers are recounted whenever the page's sections change.
 */
const NUMBERED=":scope>:is(.case-his,.case-requisition,.case-laboratory,.case-request,.case-documents,.clinical-readiness,.case-results,.case-activity-details,.case-pet-evidence)";
function title(el:HTMLElement):HTMLElement|null{
 if(el.classList.contains("case-results"))return el.querySelector<HTMLElement>("#anc-results-h");
 if(el.tagName==="DETAILS")return el.querySelector<HTMLElement>(":scope>summary");
 return el.querySelector<HTMLElement>("h2");
}
export function renumber(root:HTMLElement){
 const shown=[...root.querySelectorAll<HTMLElement>(NUMBERED)]
  .map((el,i)=>({el,i,title:title(el),order:Number(getComputedStyle(el).order)||0}))
  .filter(s=>s.title&&s.el.getClientRects().length>0)
  .sort((a,b)=>a.order-b.order||a.i-b.i);
 const keep=new Set<HTMLElement>();
 shown.forEach(({title:t},n)=>{const v=String(n+1);keep.add(t!);if(t!.dataset.n!==v)t!.dataset.n=v;});
 root.querySelectorAll<HTMLElement>("[data-n]").forEach(t=>{if(!keep.has(t))delete t.dataset.n;});
}
export function useSectionNumbers(ref:RefObject<HTMLElement|null>,key:unknown){
 useEffect(()=>{
  const root=ref.current;if(!root)return;
  renumber(root);
  let frame=0;
  const observer=new MutationObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>renumber(root));});
  observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:["class"]});
  return()=>{observer.disconnect();cancelAnimationFrame(frame);};
 },[ref,key]);
}

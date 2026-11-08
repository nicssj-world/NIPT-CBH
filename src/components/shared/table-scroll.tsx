"use client";
import {forwardRef,useEffect,useImperativeHandle,useRef,useState,type ReactNode} from "react";

/**
 * Keyboard-scrollable table region (DESIGN: role=region + Thai aria-label + tabIndex 0) with the Owner's top horizontal
 * scrollbar (ANC03). Owner 2026-11-08: the top rail stays, but appears only while the table is wider than its region.
 */
export const TableScroll=forwardRef<HTMLDivElement,{label:string;railLabel?:string;className?:string;children:ReactNode}>(function TableScroll({label,railLabel,className,children},ref){
 const rail=useRef<HTMLDivElement>(null),region=useRef<HTMLDivElement>(null),sizer=useRef<HTMLDivElement>(null);
 const [overflow,setOverflow]=useState(false);
 useImperativeHandle(ref,()=>region.current as HTMLDivElement);
 useEffect(()=>{const r=rail.current,g=region.current;if(!r||!g)return;
  const sync=()=>{const table=g.firstElementChild as HTMLElement|null;const w=table?.scrollWidth??g.scrollWidth;if(sizer.current)sizer.current.style.width=w+"px";setOverflow(w>g.clientWidth+1);if(r.scrollLeft!==g.scrollLeft)r.scrollLeft=g.scrollLeft;};
  const fromRail=()=>{if(g.scrollLeft!==r.scrollLeft)g.scrollLeft=r.scrollLeft;};
  const fromRegion=()=>{if(r.scrollLeft!==g.scrollLeft)r.scrollLeft=g.scrollLeft;};
  sync();const o=new ResizeObserver(sync);o.observe(g);if(g.firstElementChild)o.observe(g.firstElementChild);
  r.addEventListener("scroll",fromRail,{passive:true});g.addEventListener("scroll",fromRegion,{passive:true});
  return()=>{o.disconnect();r.removeEventListener("scroll",fromRail);g.removeEventListener("scroll",fromRegion);};
 });
 return <>
  <div className="table-scroll-rail" ref={rail} hidden={!overflow} role="region" tabIndex={overflow?0:-1} aria-label={railLabel??"แถบเลื่อนแนวนอนของ"+label}><div aria-hidden="true" ref={sizer}/></div>
  <div className={"table-scroll"+(className?" "+className:"")} ref={region} role="region" tabIndex={0} aria-label={label}>{children}</div>
 </>;
});

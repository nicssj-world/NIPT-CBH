"use client";
import {useId,useState} from "react";
import {monthLabel,monthLabelLong} from "./month-label";
import "./dashboard-charts.css";

/**
 * Charts for the statistics tabs (dataviz method, same rules as MonthBars): one axis, thin marks, 2 px surface gaps, hairline grid,
 * a legend whenever there are two or more series, a hover / keyboard readout, and every value also in the table under "ดูเป็นตาราง".
 * Status tones (bad / good / neutral / warn) always come with their words in the legend, never colour alone.
 */
export type Tone="s1"|"s2"|"bad"|"warn"|"good"|"neutral";
const W=560,H=210,PAD={top:20,right:10,bottom:28,left:38};
const nice=(v:number)=>{if(v<=4)return 4;if(v<=6)return 6;if(v<=8)return 8;if(v<=10)return 10;const p=10**Math.floor(Math.log10(v)),n=v/p;return (n<=1?1:n<=2?2:n<=5?5:10)*p;};
const num=(v:number|null)=>v===null?"—":v.toLocaleString("th-TH",{maximumFractionDigits:1});

function Legend({parts}:{parts:{name:string;tone:Tone}[]}){
 return parts.length>1?<ul className="dash-legend" aria-label="คำอธิบายสี">{parts.map(p=><li key={p.name}><span className={`dash-key t-${p.tone}`} aria-hidden="true"/>{p.name}</li>)}</ul>:null;
}
function Table({title,head,rows}:{title:string;head:string[];rows:(string|number|null)[][]}){
 return <details className="dash-table"><summary>ดูเป็นตาราง</summary>
  <div className="table-wrap" role="region" aria-label={`ตาราง ${title}`} tabIndex={0}><table className="data-table"><thead><tr>{head.map((h,i)=><th scope="col" key={h} className={i?"num":undefined}>{h}</th>)}</tr></thead>
   <tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=>j?<td key={j} className="num">{typeof c==="number"?num(c):c??"—"}</td>:<td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
 </details>;
}

/** Columns stacked by part (for example risk level per month). The part order is fixed; the stack always starts at the baseline. */
export function StackedMonthBars({title,note,parts,months}:{title:string;note?:string;parts:{name:string;tone:Tone}[];months:{month:string;values:number[]}[]}){
 const id=useId(),[active,setActive]=useState<number|null>(null);
 const totals=months.map(m=>m.values.reduce((a,b)=>a+b,0)),max=nice(Math.max(1,...totals)),ticks=[0,max/2,max];
 const plotW=W-PAD.left-PAD.right,plotH=H-PAD.top-PAD.bottom,band=plotW/Math.max(1,months.length),barW=Math.min(24,band*0.62);
 const y=(v:number)=>PAD.top+plotH-(v/max)*plotH,shown=months[active??months.length-1];
 return <figure className="dash-chart" aria-labelledby={`${id}-t`}>
  <figcaption id={`${id}-t`}><strong>{title}</strong>{note&&<span className="dash-chart-note">{note}</span>}</figcaption>
  <Legend parts={parts}/>
  <p className="dash-readout" aria-hidden="true">{shown?<><span>{monthLabelLong(shown.month)}</span>{parts.map((p,i)=><span key={p.name}><strong className="num">{num(shown.values[i])}</strong> {p.name}</span>)}</>:" "}</p>
  <svg viewBox={`0 0 ${W} ${H}`} className="dash-svg" role="img" aria-label={`${title} รายเดือน ดูตัวเลขได้ในตารางด้านล่าง`} onPointerLeave={()=>setActive(null)}>
   {ticks.map(t=><g key={t} className="dash-grid"><line x1={PAD.left} x2={W-PAD.right} y1={y(t)} y2={y(t)}/><text x={PAD.left-6} y={y(t)} dy="0.35em" textAnchor="end">{t.toLocaleString("th-TH")}</text></g>)}
   {months.map((m,i)=>{const x=PAD.left+band*i+(band-barW)/2;let acc=0;
    return <g key={m.month} className={"dash-col"+(active===i?" on":"")} tabIndex={0} aria-label={`${monthLabelLong(m.month)}: ${parts.map((p,j)=>`${p.name} ${num(m.values[j])}`).join(" · ")}`} onPointerEnter={()=>setActive(i)} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)}>
     <rect className="dash-hit" x={PAD.left+band*i} y={PAD.top} width={band} height={plotH}/>
     {m.values.map((v,j)=>{if(v<=0)return null;const y1=y(acc+v),y0=y(acc);acc+=v;return <rect key={j} className={`dash-seg t-${parts[j].tone}`} x={x} y={y1} width={barW} height={Math.max(1,y0-y1)}/>;})}
     <text className="dash-x" x={PAD.left+band*i+band/2} y={H-8} textAnchor="middle">{monthLabel(m.month)}</text>
    </g>;})}
   <line className="dash-base" x1={PAD.left} x2={W-PAD.right} y1={PAD.top+plotH} y2={PAD.top+plotH}/>
  </svg>
  <Table title={title} head={["เดือน",...parts.map(p=>p.name)]} rows={months.map(m=>[monthLabelLong(m.month),...m.values])}/>
 </figure>;
}

/** Lines per month (at most two series) with an optional reference line, for example the TAT limit. */
export function TrendLines({title,note,series,months,unit,reference}:{title:string;note?:string;series:{name:string}[];months:{month:string;values:(number|null)[]}[];unit?:string;reference?:{value:number;label:string}}){
 const id=useId(),[active,setActive]=useState<number|null>(null);
 const max=unit==="%"?100:nice(Math.max(1,reference?.value??0,...months.flatMap(m=>m.values.map(v=>v??0)))*1.05),ticks=[0,max/2,max];
 const plotW=W-PAD.left-PAD.right,plotH=H-PAD.top-PAD.bottom,band=plotW/Math.max(1,months.length);
 const x=(i:number)=>PAD.left+band*i+band/2,y=(v:number)=>PAD.top+plotH-(v/max)*plotH,shown=months[active??months.length-1];
 const u=unit?` ${unit}`:"";
 return <figure className="dash-chart" aria-labelledby={`${id}-t`}>
  <figcaption id={`${id}-t`}><strong>{title}</strong>{note&&<span className="dash-chart-note">{note}</span>}</figcaption>
  {series.length>1&&<ul className="dash-legend" aria-label="คำอธิบายสี">{series.map((s,i)=><li key={s.name}><span className={`dash-line s${i+1}`}/>{s.name}</li>)}{reference&&<li><span className="dash-line ref"/>{reference.label}</li>}</ul>}
  <p className="dash-readout" aria-hidden="true">{shown?<><span>{monthLabelLong(shown.month)}</span>{series.map((s,i)=><span key={s.name}>{series.length>1&&<span className={`dash-line s${i+1}`}/>}<strong className="num">{num(shown.values[i])}</strong>{u}{series.length>1?` ${s.name}`:""}</span>)}</>:" "}</p>
  <svg viewBox={`0 0 ${W} ${H}`} className="dash-svg" role="img" aria-label={`${title} รายเดือน ดูตัวเลขได้ในตารางด้านล่าง`} onPointerLeave={()=>setActive(null)}>
   {ticks.map(t=><g key={t} className="dash-grid"><line x1={PAD.left} x2={W-PAD.right} y1={y(t)} y2={y(t)}/><text x={PAD.left-6} y={y(t)} dy="0.35em" textAnchor="end">{t.toLocaleString("th-TH")}</text></g>)}
   {reference&&<g><line className="dash-ref" x1={PAD.left} x2={W-PAD.right} y1={y(reference.value)} y2={y(reference.value)}/><text className="dash-ref-text" x={W-PAD.right} y={y(reference.value)-5} textAnchor="end">{reference.label}</text></g>}
   {series.map((s,j)=>{const pts=months.flatMap((m,i)=>m.values[j]===null?[]:[[x(i),y(m.values[j]!)] as const]);
    return <g key={s.name}>{pts.length>1&&<polyline className={`dash-trend s${j+1}`} points={pts.map(p=>p.join(",")).join(" ")}/>}
     {months.map((m,i)=>m.values[j]===null?null:<circle key={i} className={`dash-dot s${j+1}`} cx={x(i)} cy={y(m.values[j]!)} r={active===i?5:4}/>)}</g>;})}
   {months.map((m,i)=><g key={m.month} className={"dash-col"+(active===i?" on":"")} tabIndex={0} aria-label={`${monthLabelLong(m.month)}: ${series.map((s,j)=>`${s.name} ${num(m.values[j])}${u}`).join(" · ")}`} onPointerEnter={()=>setActive(i)} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)}>
     <rect className="dash-hit" x={PAD.left+band*i} y={PAD.top} width={band} height={plotH}/>
     <text className="dash-x" x={x(i)} y={H-8} textAnchor="middle">{monthLabel(m.month)}</text></g>)}
   <line className="dash-base" x1={PAD.left} x2={W-PAD.right} y1={PAD.top+plotH} y2={PAD.top+plotH}/>
  </svg>
  <Table title={title} head={["เดือน",...series.map(s=>s.name)]} rows={months.map(m=>[monthLabelLong(m.month),...m.values])}/>
 </figure>;
}

/** Horizontal bars, one per row; several parts stack on the row (for example in time / near due / overdue). Labels sit left, the total at the end. */
export function HBars({title,note,parts,rows,unit}:{title:string;note?:string;parts:{name:string;tone:Tone}[];rows:{label:string;sub?:string;values:number[]}[];unit?:string}){
 const id=useId(),max=Math.max(1,...rows.map(r=>r.values.reduce((a,b)=>a+b,0)));
 return <figure className="dash-chart" aria-labelledby={`${id}-t`}>
  <figcaption id={`${id}-t`}><strong>{title}</strong>{note&&<span className="dash-chart-note">{note}</span>}</figcaption>
  <Legend parts={parts}/>
  {rows.length===0?<p className="dash-empty">ยังไม่มีข้อมูล</p>:<ul className="dash-hbars" aria-label={title}>{rows.map(r=>{const tot=r.values.reduce((a,b)=>a+b,0);
   return <li key={r.label}><span className="dash-hlabel">{r.label}{r.sub&&<small>{r.sub}</small>}</span>
    <span className="dash-htrack" aria-hidden="true">{r.values.map((v,i)=>v>0&&<span key={i} className={`dash-hseg t-${parts[i].tone}`} style={{width:`${v/max*100}%`}}/>)}</span>
    <span className="dash-hnum num">{tot.toLocaleString("th-TH")}{unit?<small> {unit}</small>:null}</span></li>;})}</ul>}
  <Table title={title} head={["รายการ",...parts.map(p=>p.name)]} rows={rows.map(r=>[r.label,...r.values])}/>
 </figure>;
}

/** Distribution of a count by whole days; buckets after `limit` are drawn in the second colour. */
export function Histogram({title,note,buckets,limit,limitLabel,names}:{title:string;note?:string;buckets:{label:string;n:number}[];limit:number;limitLabel:string;names:[string,string]}){
 const id=useId(),[active,setActive]=useState<number|null>(null);
 const max=nice(Math.max(1,...buckets.map(b=>b.n))),ticks=[0,max/2,max];
 const plotW=W-PAD.left-PAD.right,plotH=H-PAD.top-PAD.bottom,band=plotW/Math.max(1,buckets.length),barW=Math.min(24,band*0.7);
 const y=(v:number)=>PAD.top+plotH-(v/max)*plotH,lx=PAD.left+band*(limit+1),shown=buckets[active??-1];
 return <figure className="dash-chart" aria-labelledby={`${id}-t`}>
  <figcaption id={`${id}-t`}><strong>{title}</strong>{note&&<span className="dash-chart-note">{note}</span>}</figcaption>
  <Legend parts={[{name:names[0],tone:"s1"},{name:names[1],tone:"s2"}]}/>
  <p className="dash-readout" aria-hidden="true">{shown?<><span>ใช้ {shown.label} วันทำการ</span><span><strong className="num">{shown.n.toLocaleString("th-TH")}</strong> ราย</span></>:" "}</p>
  <svg viewBox={`0 0 ${W} ${H}`} className="dash-svg" role="img" aria-label={`${title}: ${buckets.map(b=>`${b.label} วัน ${b.n} ราย`).join(", ")}`} onPointerLeave={()=>setActive(null)}>
   {ticks.map(t=><g key={t} className="dash-grid"><line x1={PAD.left} x2={W-PAD.right} y1={y(t)} y2={y(t)}/><text x={PAD.left-6} y={y(t)} dy="0.35em" textAnchor="end">{t.toLocaleString("th-TH")}</text></g>)}
   {buckets.map((b,i)=>{const x=PAD.left+band*i+(band-barW)/2,top=y(b.n),h=PAD.top+plotH-top,r=Math.min(4,h,barW/2);
    return <g key={b.label} className={"dash-col"+(active===i?" on":"")} tabIndex={0} aria-label={`ใช้ ${b.label} วันทำการ ${b.n} ราย ${i<=limit?names[0]:names[1]}`} onPointerEnter={()=>setActive(i)} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)}>
     <rect className="dash-hit" x={PAD.left+band*i} y={PAD.top} width={band} height={plotH}/>
     {b.n>0&&<path className={`dash-bar s${i<=limit?1:2}`} d={`M${x},${PAD.top+plotH}V${top+r}Q${x},${top} ${x+r},${top}H${x+barW-r}Q${x+barW},${top} ${x+barW},${top+r}V${PAD.top+plotH}Z`}/>}
     <text className="dash-x" x={PAD.left+band*i+band/2} y={H-8} textAnchor="middle">{b.label}</text></g>;})}
   <g><line className="dash-ref" x1={lx} x2={lx} y1={PAD.top-6} y2={PAD.top+plotH}/><text className="dash-ref-text" x={lx-5} y={PAD.top+4} textAnchor="end">{limitLabel}</text></g>
   <line className="dash-base" x1={PAD.left} x2={W-PAD.right} y1={PAD.top+plotH} y2={PAD.top+plotH}/>
  </svg>
  <p className="dash-axis-note">แกนนอน = จำนวนวันทำการตั้งแต่ Lab รับตัวอย่างถึงออกผล</p>
  <Table title={title} head={["วันทำการ","จำนวน (ราย)"]} rows={buckets.map(b=>[b.label,b.n])}/>
 </figure>;
}

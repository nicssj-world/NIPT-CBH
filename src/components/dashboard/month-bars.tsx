"use client";
import {useId,useState} from "react";
import {monthLabel,monthLabelLong} from "./month-label";
import "./dashboard-charts.css";


export type MonthBarsProps={
 title:string;
 /** One line under the title that says what is counted. */
 note?:string;
 /** One or two series; slot order is fixed (series-1 then series-2) and never depends on the values. */
 series:{name:string}[];
 months:{month:string;values:(number|null)[]}[];
 /** Percent charts fix the axis at 0–100. */
 unit?:'%';
};

const W=560,H=200,PAD={top:24,right:8,bottom:28,left:36},BAR_MAX=24,GAP=2;
const nice=(v:number)=>{if(v<=4)return 4;if(v<=6)return 6;if(v<=8)return 8;if(v<=10)return 10;const p=10**Math.floor(Math.log10(v)),n=v/p;return (n<=1?1:n<=2?2:n<=5?5:10)*p;};
const fmt=(v:number|null,unit?:'%')=>v===null?'—':unit==='%'?`${Math.round(v)}%`:v.toLocaleString('th-TH');

/**
 * Monthly columns on one axis (dataviz method): bars ≤ 24 px with a 4 px rounded data end and a square baseline, 2 px surface gap
 * between neighbours, hairline grid, the latest month labelled, a legend only for two series, and a hover / keyboard readout.
 * Every value is also in the table under "ดูเป็นตาราง", so nothing depends on colour or on hovering.
 */
export function MonthBars({title,note,series,months,unit}:MonthBarsProps){
 const id=useId(),[active,setActive]=useState<number|null>(null);
 const max=unit==='%'?100:nice(Math.max(1,...months.flatMap(m=>m.values.map(v=>v??0))));
 const ticks=[0,max/2,max];
 const plotW=W-PAD.left-PAD.right,plotH=H-PAD.top-PAD.bottom,band=plotW/Math.max(1,months.length);
 const barW=Math.min(BAR_MAX,(band*0.7-GAP*(series.length-1))/series.length);
 const y=(v:number)=>PAD.top+plotH-(v/max)*plotH;
 const last=months.length-1,shown=active??last;
 const readout=months[shown];
 return <figure className="dash-chart" aria-labelledby={`${id}-t`}>
  <figcaption id={`${id}-t`}><strong>{title}</strong>{note&&<span className="dash-chart-note">{note}</span>}</figcaption>
  {series.length>1&&<ul className="dash-legend" aria-label="คำอธิบายสี">{series.map((s,i)=><li key={s.name}><span className={`dash-key s${i+1}`} aria-hidden="true"/>{s.name}</li>)}</ul>}
  <p className="dash-readout" aria-hidden="true">{readout?<><span>{monthLabelLong(readout.month)}</span>{series.map((s,i)=><span key={s.name}>{series.length>1&&<span className={`dash-line s${i+1}`}/>}<strong className="num">{fmt(readout.values[i],unit)}</strong>{series.length>1?` ${s.name}`:''}</span>)}</>:' '}</p>
  <svg viewBox={`0 0 ${W} ${H}`} className="dash-svg" role="img" aria-label={`${title} รายเดือน ดูตัวเลขได้ในตารางด้านล่าง`} onPointerLeave={()=>setActive(null)}>
   {ticks.map(t=><g key={t} className="dash-grid"><line x1={PAD.left} x2={W-PAD.right} y1={y(t)} y2={y(t)}/><text x={PAD.left-6} y={y(t)} dy="0.35em" textAnchor="end">{unit==='%'?`${t}%`:t.toLocaleString('th-TH')}</text></g>)}
   {months.map((m,i)=>{const x0=PAD.left+band*i+(band-(barW*series.length+GAP*(series.length-1)))/2;
    return <g key={m.month} className={"dash-col"+(active===i?" on":"")} tabIndex={0} aria-label={`${monthLabelLong(m.month)}: ${series.map((s,j)=>`${s.name} ${fmt(m.values[j],unit)}`).join(' · ')}`}
     onPointerEnter={()=>setActive(i)} onFocus={()=>setActive(i)} onBlur={()=>setActive(null)}>
     <rect className="dash-hit" x={PAD.left+band*i} y={PAD.top} width={band} height={plotH}/>
     {m.values.map((v,j)=>{if(v===null||v<=0)return null;const x=x0+j*(barW+GAP),top=y(v),h=PAD.top+plotH-top,r=Math.min(4,h,barW/2);
      return <path key={j} className={`dash-bar s${j+1}`} d={`M${x},${PAD.top+plotH}V${top+r}Q${x},${top} ${x+r},${top}H${x+barW-r}Q${x+barW},${top} ${x+barW},${top+r}V${PAD.top+plotH}Z`}/>;})}
     {i===last&&series.length===1&&m.values[0]!==null&&<text className="dash-value" x={x0+barW/2} y={y(m.values[0]!)-6} textAnchor="middle">{fmt(m.values[0],unit)}</text>}
     <text className="dash-x" x={PAD.left+band*i+band/2} y={H-8} textAnchor="middle">{monthLabel(m.month)}</text>
    </g>;})}
   <line className="dash-base" x1={PAD.left} x2={W-PAD.right} y1={PAD.top+plotH} y2={PAD.top+plotH}/>
  </svg>
  <details className="dash-table"><summary>ดูเป็นตาราง</summary>
   <div className="table-wrap" role="region" aria-label={`ตาราง ${title}`} tabIndex={0}><table className="data-table"><thead><tr><th scope="col">เดือน</th>{series.map(s=><th scope="col" key={s.name} className="num">{s.name}</th>)}</tr></thead>
    <tbody>{months.map(m=><tr key={m.month}><td>{monthLabelLong(m.month)}</td>{m.values.map((v,j)=><td key={j} className="num">{fmt(v,unit)}</td>)}</tr>)}</tbody></table></div>
  </details>
 </figure>;
}

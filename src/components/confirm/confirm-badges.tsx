"use client";
import {Icon} from "../p2/anc-progress-view";
import "../shared/console.css";
import {STATUS_LABEL,OUTCOME_LABEL,FINDING_LABEL,hasResult,type ConfirmStatus,type FindingKey,type Outcome} from "../../../packages/confirm/model";

/** Status as icon + words (DESIGN.md: colour is supplemental only). */
export function StatusBadge({status}:{status:ConfirmStatus}){
 const tone=status==="PENDING"?"tone-waiting":hasResult(status)?"tone-done":"tone-warn",icon=status==="PENDING"?"waiting":hasResult(status)?"done":"stop";
 return <span className={"progress-badge "+tone}><Icon name={icon}/>{STATUS_LABEL[status]}</span>;
}
/** The case's comparison: every finding a True positive = ผลตรงกัน, otherwise ผลไม่ตรง. */
export function MatchBadge({value}:{value:boolean}){
 return value?<span className="progress-badge tone-done"><Icon name="done"/>ผลตรงกัน</span>:<span className="progress-badge tone-stop"><Icon name="stop"/>ผลไม่ตรง</span>;
}
export function OutcomeList({screen,findings}:{screen:FindingKey[];findings:Partial<Record<FindingKey,Outcome>>}){
 return <span className="confirm-outcomes">{screen.map(k=><span key={k}>{FINDING_LABEL[k]}: {findings[k]?OUTCOME_LABEL[findings[k]!]:"—"}</span>)}</span>;
}

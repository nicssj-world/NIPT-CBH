"use client";
import {LabIcon,type LabIconName} from "../shared/lab-icons";
import "./repeat-badge.css";

export type RepeatKind="RE_LIBRARY"|"RE_EXTRACTION"|"RE_SAMPLING";
const META:Record<RepeatKind,{label:string;icon:LabIconName}>={
 RE_LIBRARY:{label:"Re-Library",icon:"dna"},
 RE_EXTRACTION:{label:"Re-Extraction",icon:"flask"},
 RE_SAMPLING:{label:"Re-Sampling",icon:"refresh"},
};
/** Marks a sample that is in this Run because of a repeat (Owner 2026-11-09); the same pill is used on every page of the Run. Always words, never colour alone. */
export function RepeatBadge({kind}:{kind?:string|null}){
 const m=kind?META[kind as RepeatKind]:undefined;
 if(!m)return null;
 return <span className="repeat-badge" data-kind={kind}><LabIcon name={m.icon} size={14}/>{m.label}</span>;
}


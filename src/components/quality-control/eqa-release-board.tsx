"use client";
import {useState} from "react";
import {ReleaseBoard} from "../p5/release-board";
import type {BoardTab} from "../p5/release-board-logic";
import "../p5/result-workflow.css";

// EQA reports wait in "รอส่ง HIS" like patient results and are certified by the same "ส่ง HIS" step; EQA never produces an HIS job.
export function EqaReleaseBoard(){
 const [tab,setTab]=useState<BoardTab>("READY");
 return <ReleaseBoard scope="EQA" tab={tab} onTab={setTab}/>;
}

import type {NextRequest} from "next/server";
import {withTransaction} from "../../../../../../../packages/db/connection";
import {signerSamplePreview} from "../../../../../../../packages/readygen/signer-preview";
import {readJson} from "../../../../../../server/http";
import {task3Mutation,reportDeps,fileResponse} from "../../../../../../server/task3";
/** Watermarked sample report (Singleton or Twin master, synthetic values, this signer in both slots) for the administrator verifying a signer profile. Never stored. */
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return task3Mutation(request,"TASK3_SIGNER_PREVIEW",async user=>{const {id}=await params,data=await readJson(request,1024);
 const r=await withTransaction(db=>signerSamplePreview(db,user,reportDeps(),{profileId:id,kind:(data as {kind?:unknown}).kind}));
 return fileResponse(r.bytes,"application/pdf","signer-sample-preview.pdf",true);});}

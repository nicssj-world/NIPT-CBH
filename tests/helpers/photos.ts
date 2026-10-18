import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {Queryable} from '../../packages/db/connection';
import type {Staff} from '../../packages/lab/core';
import * as svc from '../../packages/run-photos/service';
import {putPhoto,resetPhotoStorageBreaker} from '../../packages/run-photos/store';
import {tx} from './lab';

/** A structurally valid baseline JPEG header (SOI, APP0, SOF0 with the given size) followed by random bytes. Synthetic only. */
export function syntheticJpeg(width=4032,height=3024,bodyBytes=4096){
 const app0=Buffer.from([0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,0x00,0x01,0x00,0x00]);
 const sof=Buffer.from([0xff,0xc0,0x00,0x11,0x08,height>>8,height&255,width>>8,width&255,0x03,0x01,0x22,0x00,0x02,0x11,0x01,0x03,0x11,0x01]);
 return Buffer.concat([Buffer.from([0xff,0xd8]),app0,sof,Buffer.from([0xff,0xda,0x00,0x08]),randomBytes(bodyBytes),Buffer.from([0xff,0xd9])]);
}
export const syntheticThumb=()=>syntheticJpeg(480,360,512);
export const PNG_1x1=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==','base64');

/** Temporary photo roots for one test file; RUN_PHOTO_DEFAULT_ROOT points at the first. */
export async function photoRoots(){
 const base=await mkdtemp(path.join(os.tmpdir(),'nipt-run-photos-'));const previous=process.env.RUN_PHOTO_DEFAULT_ROOT;
 process.env.RUN_PHOTO_DEFAULT_ROOT=path.join(base,'default');resetPhotoStorageBreaker();
 return {base,dir:(name:string)=>path.join(base,name),close:async()=>{if(previous===undefined)delete process.env.RUN_PHOTO_DEFAULT_ROOT;else process.env.RUN_PHOTO_DEFAULT_ROOT=previous;resetPhotoStorageBreaker();await rm(base,{recursive:true,force:true});}};
}
/** Plays the upload route: validate, choose the root, write + verify bytes, then record in one transaction. */
export async function uploadPhoto(db:Queryable,user:Staff,batchId:string,o:{bytes?:Buffer;thumb?:Buffer|null;name?:string;caption?:string;sampleFrom?:number|null;sampleTo?:number|null;takenOn?:string;key?:string}={}){
 const bytes=o.bytes??syntheticJpeg(),thumb=o.thumb===undefined?syntheticThumb():o.thumb;
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 const prepared=svc.preparePhoto({batchId,idempotencyKey:o.key??randomUUID().replaceAll('-',''),caption:o.caption??'',sampleFrom:o.sampleFrom??null,sampleTo:o.sampleTo??null,takenOn:o.takenOn??today},{name:o.name??'IMG_0001.jpg',bytes},thumb);
 const root=await tx(db,t=>svc.uploadRoot(t));
 const original=await putPhoto(root.root_path,prepared.bytes);
 const thumbHash=prepared.thumb?(await putPhoto(root.root_path,prepared.thumb)).hash:null;
 return {...await tx(db,t=>svc.recordPhoto(t,user,prepared,{root,sha256:original.hash,thumbSha256:thumbHash})),sha256:original.hash,root};
}

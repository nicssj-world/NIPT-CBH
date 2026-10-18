import Link from "next/link";
import {currentUser} from "../../../../server/http";
import {authorize} from "../../../../../packages/security/policy";
import {withTransaction} from "../../../../../packages/db/connection";
import {searchRunPhotos,type PhotoSearch} from "../../../../../packages/run-photos/service";
import {RunPhotoSearch} from "../../../../components/run-photos/photo-search";

export default async function RunPhotosPage(){
 const user=(await currentUser())!;
 if(!authorize(user,"photo.read",{},"read"))return <section className="panel"><h1>ภาพประจำ Run</h1><p role="alert">ไม่มีสิทธิ์เปิดภาพประจำ Run</p></section>;
 const initial=JSON.parse(JSON.stringify(await withTransaction(db=>searchRunPhotos(db,user,{})))) as PhotoSearch;
 return <>
  <header className="page-header"><div><h1>ภาพประจำ Run</h1><p className="muted">ภาพชั้นวางหลอดและฉลากเป็นหลักฐานประกอบการปฏิบัติงาน ไม่บังคับ และไม่เป็นเงื่อนไขของ Task List, QC, Pooling, ผลตรวจ หรือ HIS</p></div><Link className="button secondary" href="/lab/batches">Batch / Task List</Link></header>
  <RunPhotoSearch initial={initial}/>
 </>;
}

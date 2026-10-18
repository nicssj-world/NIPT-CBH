import Link from "next/link";
import {currentUser} from "../../../../../server/http";
import {authorize} from "../../../../../../packages/security/policy";
import {withTransaction} from "../../../../../../packages/db/connection";
import {runGallery,type RunGallery} from "../../../../../../packages/run-photos/service";
import {displayBe} from "../../../../../../packages/domain/thai-date";
import {RunPhotoGallery} from "../../../../../components/run-photos/run-gallery";
import {runStateText} from "../../../../../components/run-photos/labels";

export default async function RunPhotoGalleryPage({params}:{params:Promise<{batchId:string}>}){
 const user=(await currentUser())!;const {batchId}=await params;
 if(!authorize(user,"photo.read",{},"read")||!/^[a-f0-9-]{36}$/.test(batchId))return <section className="panel"><h1>ภาพประจำ Run</h1><p role="alert">ไม่มีสิทธิ์หรือไม่พบ Run</p></section>;
 const data=await withTransaction(db=>runGallery(db,user,batchId)).catch(()=>null);
 if(!data)return <section className="panel"><h1>ภาพประจำ Run</h1><p role="alert">ไม่พบ Run</p></section>;
 const g=JSON.parse(JSON.stringify(data)) as RunGallery;
 return <>
  <header className="page-header"><div><h1>ภาพประจำ {g.run.runLabel}</h1>
   <p className="muted">{runStateText(g.run.state)} · ตัวอย่าง {g.placement.length} คน{g.run.workDates.length?` · วันทำงาน ${g.run.workDates.map(d=>displayBe(d)).join(", ")}`:""} · ภาพเป็นหลักฐานประกอบ ไม่บังคับ</p></div>
   <div className="row"><Link className="button secondary" href={`/lab/batches/${g.run.id}`}>กลับหน้า Run</Link><Link className="button secondary" href="/lab/photos">ค้นหาภาพ</Link></div></header>
  <RunPhotoGallery initial={g}/>
 </>;
}

import {redirect} from "next/navigation";
import {currentUser} from "../../../../server/http";
import {authorize} from "../../../../../packages/security/policy";
import {withTransaction} from "../../../../../packages/db/connection";
import {storageOverview} from "../../../../../packages/run-photos/service";
import {StorageSettings,type StorageOverview} from "../../../../components/run-photos/storage-settings";

export default async function RunPhotoSettingsPage(){
 const user=(await currentUser())!;
 if(!authorize(user,"photo.storage.configure",{},"write")&&!authorize(user,"settings.read",{},"read"))redirect("/");
 const data=JSON.parse(JSON.stringify(await withTransaction(db=>storageOverview(db,user)))) as StorageOverview;
 return <>
  <header className="page-header"><div><h1>Run Photo Evidence — Storage Path</h1><p className="muted">ที่เก็บไฟล์ภาพประจำ Run บนเครื่องแม่ข่ายหรือ Network Share · ภาพเปิดผ่านระบบที่ตรวจสิทธิ์เท่านั้น ไม่มี URL สาธารณะ</p></div></header>
  <StorageSettings initial={data}/>
 </>;
}

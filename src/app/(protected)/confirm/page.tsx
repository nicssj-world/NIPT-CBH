import {redirect} from "next/navigation";
import {currentUser} from "../../../server/http";
import {authorize} from "../../../../packages/security/policy";
import {ConfirmBoard} from "../../../components/confirm/confirm-board";
/** ผลตรวจยืนยัน (Confirm) (Owner 2026-11-23): Lab records; ANC, the clinical approver and the auditor read. */
export default async function ConfirmPage(){const user=(await currentUser())!;if(!authorize(user,"confirm.read",{},"read"))redirect("/");
 return <ConfirmBoard canWrite={authorize(user,"confirm.write",{},"write")}/>;}

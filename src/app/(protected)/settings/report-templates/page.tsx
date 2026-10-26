import {redirect} from "next/navigation";
import {currentUser} from "../../../../server/http";
import {authorize} from "../../../../../packages/security/policy";
import {ReportTemplatesPanel} from "../../../../components/report-templates-panel";
/** OWNER-LAB-056: Settings → แม่แบบรายงาน (ReadyGen-style Word templates; approval is a different person, see the service). */
export default async function ReportTemplatesPage(){const user=(await currentUser())!;
 if(!authorize(user,"report.template.manage",{},"read")&&!authorize(user,"settings.approve",{},"approve"))redirect("/settings");
 return <><header className="page-header"><div><h1>แม่แบบรายงาน</h1></div></header><ReportTemplatesPanel canManage={authorize(user,"report.template.manage",{},"write")} canApprove={authorize(user,"settings.approve",{},"approve")} userId={user.id}/></>;}

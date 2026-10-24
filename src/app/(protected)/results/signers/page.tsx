import {redirect} from "next/navigation";
import {currentUser} from "../../../../server/http";
import {authorize} from "../../../../../packages/security/policy";
import {ReportSigners} from "../../../../components/p5/report-signers";
export default async function ReportSignersPage(){const user=(await currentUser())!;if(!authorize(user,"result.review",{},"read")&&!authorize(user,"user.manage"))redirect("/");return <ReportSigners userId={user.id}/>;}

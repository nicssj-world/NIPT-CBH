import {redirect} from "next/navigation";
import {currentUser} from "../../../server/http";
import {authorize} from "../../../../packages/security/policy";
import {ResultWorkspace} from "../../../components/p5/result-workspace";
export default async function ResultsPage(){const user=(await currentUser())!;if(!authorize(user,"result.review",{},"read"))redirect("/");return <ResultWorkspace canImport={authorize(user,"result.import")} canSettings={authorize(user,"settings.read",{},"read")}/>;}

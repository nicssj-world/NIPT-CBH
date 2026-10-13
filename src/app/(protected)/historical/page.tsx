import {redirect} from "next/navigation";
import {currentUser} from "../../../server/http";
import {authorize} from "../../../../packages/security/policy";
import {HistoricalHome} from "../../../components/p5h/historical-home";
export default async function HistoricalPage(){const user=(await currentUser())!;if(!authorize(user,"history.read",{},"read"))redirect("/");return <HistoricalHome canImport={authorize(user,"history.draft",{},"write")}/>;}

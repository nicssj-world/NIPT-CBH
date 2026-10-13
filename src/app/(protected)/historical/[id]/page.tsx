import {redirect} from "next/navigation";
import {currentUser} from "../../../../server/http";
import {authorize} from "../../../../../packages/security/policy";
import {HistoricalBatch} from "../../../../components/p5h/historical-batch";
export default async function HistoricalBatchPage({params}:{params:Promise<{id:string}>}){const user=(await currentUser())!;if(!authorize(user,"history.read",{},"read"))redirect("/");const {id}=await params;
 return <HistoricalBatch id={id} canImport={authorize(user,"history.draft",{},"write")} canReview={authorize(user,"history.promote",{},"approve")}/>;}

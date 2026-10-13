import {redirect} from "next/navigation";
import {currentUser} from "../../../../server/http";
import {authorize} from "../../../../../packages/security/policy";
import {ResultReview} from "../../../../components/p5/result-review";
export default async function ResultReviewPage({params}:{params:Promise<{id:string}>}){const user=(await currentUser())!;if(!authorize(user,"result.review",{},"read"))redirect("/");const {id}=await params;return <ResultReview id={id} canMaintain={user.roles.includes("LAB_CERTIFIER")&&authorize(user,"result.revise",{},"approve")}/>;}

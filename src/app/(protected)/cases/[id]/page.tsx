import {redirect} from "next/navigation";
import {currentUser} from "../../../../server/http";
import {CaseWorkspace} from "../../../../components/p2/case-workspace";
import {AncResults} from "../../../../components/p5/anc-results";
export default async function CaseDetail({params}:{params:Promise<{id:string}>}){const {id}=await params;const user=await currentUser();if(!user)redirect("/login");const reader=user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR","LAB_STAFF","LAB_CERTIFIER"].includes(r));return <><CaseWorkspace canReadDocuments={reader} caseId={id}/>{reader&&<AncResults caseId={id}/>}</>;}

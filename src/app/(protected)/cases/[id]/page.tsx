import {redirect} from "next/navigation";
import {currentUser} from "../../../../server/http";
import {caseTimeline} from "../../../../server/cases";
import {CaseWorkspace} from "../../../../components/p2/case-workspace";
export default async function CaseDetail({params}:{params:Promise<{id:string}>}){const {id}=await params;const user=await currentUser();if(!user)redirect("/login");const timeline=await caseTimeline(user,id);return <CaseWorkspace canReadDocuments={user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR","LAB_STAFF","LAB_CERTIFIER"].includes(r))} caseId={id} timeline={timeline?{rounds:timeline.rounds,events:timeline.events.map(e=>({...e,created_at:e.created_at.toISOString()}))}:null}/>;}

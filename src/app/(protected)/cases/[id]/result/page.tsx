import {redirect} from "next/navigation";
import Link from "next/link";
import {currentUser} from "../../../../../server/http";
import {AncResults} from "../../../../../components/p5/anc-results";
import {MigrationLabSummary} from "../../../../../components/p2/case-workspace";
/** The result of one sample, opened directly from the central registry ("ดูผลตรวจ"): the values, and the exact PDF to open, download and print.
 *  It reads the same sources as the case page (ANC result viewer, LAB summary), so the registry, LAB and ANC agree. The sample details stay one click away. */
export default async function CaseResult({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const user=await currentUser();if(!user)redirect("/login");
 const reader=user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR","LAB_STAFF","LAB_CERTIFIER","APP_ADMIN"].includes(r));
 if(!reader)redirect(`/cases/${id}`);
 const ancView=user.roles.some(r=>r==="ANC_NURSE"||r==="ANC_SUPERVISOR");
 return <main className="case-result-page"><header className="page-header"><div><h1>ผลตรวจ</h1></div>
  <div className="row"><Link className="button secondary" href="/cases"><span aria-hidden="true">←</span> กลับทะเบียนกลาง</Link><Link className="button secondary" href={`/cases/${id}`}>รายละเอียดตัวอย่าง</Link></div></header>
  <div className="case-results">{!ancView&&<MigrationLabSummary caseId={id}/>}<AncResults key={id} caseId={id}/></div></main>;
}

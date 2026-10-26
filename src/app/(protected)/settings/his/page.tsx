import {redirect} from "next/navigation";
import {currentUser} from "../../../../server/http";
import {authorize} from "../../../../../packages/security/policy";
import {HisPathsPanel} from "../../../../components/his-paths-panel";
/** OWNER-LAB-055/059: Settings → HIS Integration (folder paths used by the PET scanner and the HIS delivery worker). */
export default async function HisIntegrationPage(){const user=(await currentUser())!;if(!authorize(user,"integration.configure",{},"read"))redirect("/settings");
 return <><header className="page-header"><div><h1>HIS Integration</h1></div></header><HisPathsPanel canWrite={authorize(user,"integration.configure",{},"write")}/></>;}

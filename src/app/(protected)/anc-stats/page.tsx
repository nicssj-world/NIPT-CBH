import {redirect} from "next/navigation";
import {currentUser} from "../../../server/http";
import {AncStatsPage} from "../../../components/dashboard/anc-stats";

/** ANC statistics (Owner 2026-11-12): its own menu item beside the doctor registry. Same scope as the ANC overview; the API checks it again. */
export default async function AncStatisticsPage(){
 const user=await currentUser();if(!user)redirect("/login");
 if(!user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR","APP_ADMIN"].includes(r)))redirect("/");
 return <AncStatsPage/>;
}

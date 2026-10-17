import {redirect} from "next/navigation";
import {currentUser} from "../../server/http";
import {Registry} from "../../components/p2/registry";
import {AncDashboard} from "../../components/anc/dashboard";
export default async function Overview(){const user=await currentUser();if(!user)redirect("/login");const anc=user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR"].includes(r));return anc?<AncDashboard/>:<Registry overview canAnc={false} canLab={user.roles.some(r=>["LAB_STAFF","LAB_CERTIFIER"].includes(r))}/>;}

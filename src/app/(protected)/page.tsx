import {redirect} from "next/navigation";
import {currentUser} from "../../server/http";
import {Registry} from "../../components/p2/registry";
export default async function Overview(){const user=await currentUser();if(!user)redirect("/login");return <Registry overview canAnc={user.roles.some(r=>["ANC_NURSE","ANC_SUPERVISOR"].includes(r))} canLab={user.roles.some(r=>["LAB_STAFF","LAB_CERTIFIER"].includes(r))}/>;}

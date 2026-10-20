import {operationalDataEnabled} from "../../../../packages/security/runtime";
import {redirect} from "next/navigation";
import {currentUser} from "../../../server/http";
import {authorize} from "../../../../packages/security/policy";
import {DoctorRegistry} from "../../../components/p2/doctors";
export default async function DoctorsPage(){const user=await currentUser();if(!user)redirect("/login");return <DoctorRegistry operational={operationalDataEnabled()} canManage={authorize(user,"doctor.manage",{},"write")}/>;}

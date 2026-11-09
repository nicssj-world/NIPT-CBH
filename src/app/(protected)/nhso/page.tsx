import {redirect} from "next/navigation";
import {currentUser} from "../../../server/http";
import {authorize} from "../../../../packages/security/policy";
import {NhsoBoard} from "../../../components/nhso/nhso-board";
export default async function NhsoPage(){const user=(await currentUser())!;if(!authorize(user,"nhso.entry",{},"read"))redirect("/");return <NhsoBoard/>;}

import {operationalDataEnabled} from "../../../../packages/security/runtime";
import {PatientSigning} from "../../../components/p2/signing";
export default function SigningPage(){return <PatientSigning operational={operationalDataEnabled()}/>;}

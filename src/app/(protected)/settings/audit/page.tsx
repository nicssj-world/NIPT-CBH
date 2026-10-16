import {currentUser} from '../../../../server/http';
import {authorize} from '../../../../../packages/security/policy';
import {redirect} from 'next/navigation';
import {AuditViewer} from '../../../../components/audit-viewer';
export default async function AuditPage(){if(!authorize((await currentUser())!,'audit.read',{},'read'))redirect('/');return <><header className="page-header"><h1>Audit Log</h1></header><AuditViewer/></>;}

import {currentUser} from '../../../../server/http';
import {canReadAdministration} from '../../../../../packages/admin/service';
import {redirect} from 'next/navigation';
import {AdminConsole} from '../../../../components/admin-console';
export default async function UnitsPage(){if(!canReadAdministration((await currentUser())!))redirect('/');return <><header className="page-header"><h1>จัดการหน่วยงาน</h1></header><AdminConsole mode="units"/></>;}

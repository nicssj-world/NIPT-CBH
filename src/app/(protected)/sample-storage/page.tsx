import {redirect} from 'next/navigation';
import {currentUser} from '../../../server/http';
import {authorize} from '../../../../packages/security/policy';
import {SampleStorage} from '../../../components/sample-storage';
export default async function StoragePage(){const user=(await currentUser())!;if(!authorize(user,'worksheet.read',{},'read'))redirect('/');return <SampleStorage canWrite={authorize(user,'batch.assign')} canPrint={authorize(user,'label.print')}/>;}

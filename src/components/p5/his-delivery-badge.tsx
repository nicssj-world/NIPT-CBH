import type {HisDeliveryStatus} from '../../../packages/results/his-status';

export function HisDeliveryBadge({status}:{status?:HisDeliveryStatus|null}){
 if(!status)return null;
 return <span className={`status ${status.tone}`} title={status.updatedAt?`อัปเดต ${new Date(status.updatedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}`:undefined}>{status.label}</span>;
}

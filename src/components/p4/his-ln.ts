/** OWNER-LAB-029: plain-text HIS LN (XX-XXX-X-XXXX) for labels and accessible names; on screen use <Ln/> from p2/shared,
 *  which also emphasises the last four digits. LN Halos is never formatted with this. */
export const formatHisLn=(value:string)=>/^\d{10}$/.test(value)?`${value.slice(0,2)}-${value.slice(2,5)}-${value.slice(5,6)}-${value.slice(6)}`:value;

/**
 * "วันที่ส่งตรวจ" (Owner 2026-11-12), one definition for the ANC overview and the central registry:
 * - registered by ANC: the moment ANC registered the mother (nipt_case.created_at);
 * - registered by the Lab: the specimen collection time carried by the HIS PET of the first round that has one
 *   (falls back to the Lab registration time when no PET was ever stored).
 * `c` is the alias of nipt_case in the calling query.
 */
export const sentAtSql=(c='c')=>`CASE WHEN ${c}.registration_origin='LAB_DIRECT' THEN COALESCE((
  SELECT (sf.parsed->>'specimenAt')::timestamptz FROM his_order_current so JOIN his_inbound_file_current sf ON sf.id=so.inbound_file_id
  JOIN specimen_round_current sx ON sx.id=so.round_id WHERE sx.case_id=${c}.id AND sf.parsed->>'specimenAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
  ORDER BY sx.round_number,so.his_received_at LIMIT 1),${c}.created_at) ELSE ${c}.created_at END`;
/** Inclusive Bangkok-day range on an expression; parameters are ISO dates (YYYY-MM-DD) or null. */
export const sentDayRangeSql=(expr:string,from:string,to:string)=>`(${from}::date IS NULL OR ((${expr}) AT TIME ZONE 'Asia/Bangkok')::date>=${from}::date) AND (${to}::date IS NULL OR ((${expr}) AT TIME ZONE 'Asia/Bangkok')::date<=${to}::date)`;

// Receive Date/Time ordering — Owner Lock 2026-10-12 (NIPT_CBH_P4_Receive_Date_Sorting_Owner_Lock).
// One semantic for every screen: the specimen round's actual receipt time.
//  S1  = HIS `.pet` P[23] component 2 (specimen_round.received_at, which the s1_receipt_guard forces to equal his_order.his_received_at);
//  S2 = new HIS PET P[23] component 2 when an expected redraw is matched; legacy local receipts keep their recorded time.
//  Repeat keeps the receipt time of its original specimen round.
// Never registration/case creation, `.pet` ingestion, P[23] collection or O[14] order time. Missing receipt = null, sorted last
// in both directions and never replaced by "now". Equal times fall back to immutable keys so order never flips between refreshes.
export type SortDirection = "asc" | "desc";
export const REGISTRY_DEFAULT_SORT: SortDirection = "desc";
export const READY_QUEUE_DEFAULT_SORT: SortDirection = "asc";
export function parseSortDirection(value: string | null | undefined, fallback: SortDirection): SortDirection {
  if (value === undefined || value === null || value === "") return fallback;
  if (value !== "asc" && value !== "desc") throw new Error("SORT_INVALID");
  return value;
}
const time = (v: string | Date | null | undefined) => (v === null || v === undefined || v === "" ? null : new Date(v).getTime());
/** Null-last in both directions; ties broken by the given immutable keys (string compare, ascending, never reversed). */
export function compareReceive(a: { receivedAt: string | Date | null; keys: readonly string[] }, b: { receivedAt: string | Date | null; keys: readonly string[] }, direction: SortDirection) {
  const x = time(a.receivedAt), y = time(b.receivedAt);
  if (x === null && y !== null) return 1;
  if (y === null && x !== null) return -1;
  if (x !== null && y !== null && x !== y) return direction === "asc" ? x - y : y - x;
  for (let i = 0; i < Math.max(a.keys.length, b.keys.length); i++) { const c = (a.keys[i] ?? "").localeCompare(b.keys[i] ?? ""); if (c) return c; }
  return 0;
}
/** SQL equivalent for server-side pages: `received` must be the round receipt timestamp column. */
export function receiveOrderSql(received: string, direction: SortDirection, tieKeys: readonly string[]) {
  return `${received} ${direction === "asc" ? "ASC" : "DESC"} NULLS LAST${tieKeys.map(k => `,${k}`).join("")}`;
}

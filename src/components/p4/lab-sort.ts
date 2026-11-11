import type {SortDirection} from "../../../packages/lab/receive-sort";

/** Lab screen opens with the newest LN Halos first (Owner 2026-11-11). The server/API default stays ascending. */
export const LAB_SCREEN_DEFAULT_SORT:SortDirection="desc";

/** LN Halos ascending, samples without one last; ties fall back to the immutable keys so the order never flips. */
export function byLnHalosAsc<T extends {lnHalos:string|null;hisLn:string}>(a:T,b:T):number{
 if(!a.lnHalos&&!b.lnHalos)return a.hisLn.localeCompare(b.hisLn);
 if(!a.lnHalos)return 1;
 if(!b.lnHalos)return -1;
 return a.lnHalos<b.lnHalos?-1:a.lnHalos>b.lnHalos?1:a.hisLn.localeCompare(b.hisLn);
}

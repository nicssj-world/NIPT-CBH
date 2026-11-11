/** Owner 2026-11-11: C1 of the Pooling DNA Library dilution (C1·V1 = C2·V2) is the Pool Library concentration already entered in QC2 (F14), never typed twice.
 *  Above the 3.6 ng/µL limit E52 is that value (so Excel's G52 = V1 and E55 = EB, and therefore the printed Pooling Table PDF, follow it); at or below the limit E52 stays empty.
 *  Without a concentration the values are left as they are. */
export const POOL_DILUTION_ABOVE=3.6;
export function deriveDilutionC1<T extends Record<string,unknown>>(values:T):T {
 const concentration=values['pool.concentration'];
 if(typeof concentration!=='number'||!Number.isFinite(concentration))return values;
 const derived:Record<string,unknown>={...values};
 if(concentration>POOL_DILUTION_ABOVE)derived['pool.dilutionC1']=concentration;else delete derived['pool.dilutionC1'];
 return derived as T;
}
/** Input readiness only: Excel remains the authority for G52/E55 calculations. */
export function poolDilutionReady(values:Record<string,unknown>):boolean {
 const value=values['pool.dilutionC1'];
 return typeof value==='number'&&Number.isFinite(value)&&value>0;
}
export const POOL_DILUTION_NOTICE='กรุณากรอกความเข้มข้น E52 ที่มากกว่าศูนย์ก่อนใช้ผลคำนวณ G52 / E55';

/** Input readiness only: Excel remains the authority for F52/D55 calculations. */
export function poolDilutionReady(values:Record<string,unknown>):boolean {
 const value=values['pool.dilutionC1'];
 return typeof value==='number'&&Number.isFinite(value)&&value>0;
}
export const POOL_DILUTION_NOTICE='กรุณากรอกความเข้มข้น D52 ที่มากกว่าศูนย์ก่อนใช้ผลคำนวณ F52 / D55';

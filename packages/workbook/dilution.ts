/** Input readiness only: Excel remains the authority for G52/E55 calculations. */
export function poolDilutionReady(values:Record<string,unknown>):boolean {
 const value=values['pool.dilutionC1'];
 return typeof value==='number'&&Number.isFinite(value)&&value>0;
}
export const POOL_DILUTION_NOTICE='กรุณากรอกความเข้มข้น E52 ที่มากกว่าศูนย์ก่อนใช้ผลคำนวณ G52 / E55';

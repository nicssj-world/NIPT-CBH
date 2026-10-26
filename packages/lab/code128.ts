/** Code 128 (ISO/IEC 15417) for tube labels (OWNER-LAB-004/026): subsets B and C, mod-103 check symbol.
 *  Chosen over Code 39 because digit pairs compress, so a printed code such as 26B261025001-1 fits between the
 *  corner marks of a 25 × 20 mm half. Each pattern lists bar/space widths in modules, starting with a bar. */
export const CODE128_PATTERNS=[
 '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222',
 '123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321',
 '232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121',
 '313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224',
 '111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
 '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113',
 '114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112',
] as const;
const START_B=104,START_C=105,CODE_B=100,CODE_C=99,STOP=106;
const digitRun=(value:string,from:number)=>{let n=0;while(from+n<value.length&&value[from+n]>='0'&&value[from+n]<='9')n++;return n;};

/** Symbol values (start … data … check), choosing C for digit runs of 4 or more (or a whole even all-digit value). */
export function code128Values(value:string):number[]{
 if(!value||[...value].some(ch=>ch.charCodeAt(0)<32||ch.charCodeAt(0)>126))throw new Error('CODE128_VALUE_INVALID');
 const values:number[]=[];let set:'B'|'C';let i=0;
 const lead=digitRun(value,0);
 if(lead>=4||(lead===value.length&&lead%2===0)){set='C';values.push(START_C);}else{set='B';values.push(START_B);}
 while(i<value.length){
  const run=digitRun(value,i);
  if(set==='C'){
   if(run>=2){values.push(Number(value.slice(i,i+2)));i+=2;continue;}
   values.push(CODE_B);set='B';continue;
  }
  if(run>=4){
   // An odd run starts with one digit in B so the remainder pairs exactly in C.
   if(run%2===1){values.push(value.charCodeAt(i)-32);i++;}
   values.push(CODE_C);set='C';continue;
  }
  values.push(value.charCodeAt(i)-32);i++;
 }
 const check=values.reduce((sum,v,index)=>sum+v*(index===0?1:index),0)%103;
 values.push(check);
 return values;
}
/** Bar/space widths in modules for the whole symbol including the stop pattern (no quiet zones). */
export function code128Modules(value:string):number[]{
 return [...code128Values(value),STOP].flatMap(v=>[...CODE128_PATTERNS[v]].map(Number));
}

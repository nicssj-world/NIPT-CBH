/** Registry display only. Clinical eligibility is evaluated by its existing clinical contract. */
export function registryGa(edd:string|null|undefined,collection:string|null|undefined){
 if(!edd||!collection||!/^\d{4}-\d{2}-\d{2}$/.test(edd)||!/^\d{4}-\d{2}-\d{2}$/.test(collection))return null;
 const days=280+Math.round((Date.parse(collection)-Date.parse(edd))/86400000);
 if(!Number.isFinite(days)||days<0||days>315)return null;
 return {weeks:Math.floor(days/7),days:days%7,over18:days>126};
}

/** Verified coordinates in the current locked Master, rather than the legacy field catalog's seed row numbers. */
const checks:Record<string,string>={
 'F2-15:PRECLEAN':'A19','F2-16:LYSIS':'A22','F2-16:WASH1':'A23','F2-16:WASH2':'A24','F2-16:MILLIQ':'A25',
 'F2-16:BEAD1':'E22','F2-16:BEAD2_733':'E23','F2-16:BEAD2_580':'E24','F2-16:ETHANOL75':'E25','F2-16:ELUTION':'K22',
 'F2-17:':'A27','F2-18:':'A30','F2-19:BEADS_740':'A37','F2-19:BEADS_910':'F37','F2-20:DEEPWELL':'A39',
 'F2-20:BARCODE_STRIPS':'A41','F2-21:':'A44','F2-22:BREAKAWAY':'A46','F2-22:VORTEX':'A49','F2-22:ENZYME':'A50','F2-23:':'A53',
};
export function labObservationBindings(o:{sheet_number:number|null;field_id:string;item:string;value:Record<string,unknown>}){
 const values:Record<string,unknown>={},n=o.sheet_number;
 if(n){const cell=checks[o.field_id+':'+o.item];if(cell&&o.value.checked===true)values[`check.${n}.${cell}`]=true;
  if(['F2-13','F2-14'].includes(o.field_id)&&typeof o.value.lot==='string'&&typeof o.value.expiry==='string')values[`task.${n}.${o.field_id==='F2-13'?'extractionLotExp':'libraryLotExp'}`]=`${o.value.lot} / ${o.value.expiry}`;
 }
 if(o.field_id==='F3-01'&&typeof o.value.text==='string')values['qc.operator']=o.value.text;
 return values;
}

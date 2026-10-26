// Read-only: print non-empty cells (text/formula/binding) of one sheet of the approved Owner master.
import {readFileSync} from 'node:fs';
import {inspectTaskMaster} from '../../packages/workbook/master';
const [file,sheet]=process.argv.slice(2);const r=inspectTaskMaster(readFileSync(file));
console.log('formulas',r.formulaCount,'bindings',r.bindings.length);
for(const c of r.cells.filter(c=>c.sheet===sheet&&(c.text||c.formula||c.binding)))console.log(c.cell.padEnd(5),c.classification.padEnd(10),(c.formula?'='+c.formula:'').padEnd(20),c.binding?.key??'',JSON.stringify(c.text).slice(0,90));

import ExcelJS from 'exceljs';
const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(process.argv[2]);
const ws=wb.getWorksheet(process.argv[3]);
ws.eachRow({includeEmpty:false},(row)=>{const cells=[];row.eachCell({includeEmpty:false},(c)=>{let v=c.value;if(v&&typeof v==='object')v=v.formula?('='+v.formula):v.richText?v.richText.map(t=>t.text).join(''):JSON.stringify(v);cells.push(`${c.address}:${String(v).replace(/\n/g,' ').slice(0,70)}`)});console.log(cells.join(' | '))});
console.log('merges',ws.model.merges?.join(' '));

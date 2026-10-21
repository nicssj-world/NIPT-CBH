/** Runtime-only alerts reference preserved calculated cells. Original fonts,
 * cell styles, formulas and Master bytes remain unchanged. */
export function poolingAlerts(parts:Map<string,Buffer>,values:Record<string,unknown>){
 if(!Object.keys(values).some(k=>/^slot\.\d+\.libraryQc$|^pool\.concentration$/.test(k)))return [];
 const stylePath='xl/styles.xml',sheetPath='xl/worksheets/sheet5.xml',styles=parts.get(stylePath)!.toString(),sheet=parts.get(sheetPath)!.toString();
 const dxfs=/<dxfs\b[^>]*>([\s\S]*?)<\/dxfs>/.exec(styles);if(!dxfs)throw Error('POOL_ALERT_STYLE_REQUIRED');
 const count=[...dxfs[1].matchAll(/<dxf\b/g)].length,priority=Math.max(0,...[...sheet.matchAll(/\bpriority="(\d+)"/g)].map(m=>Number(m[1])))+1;
 const font='<dxf><font><color rgb="FFFF0000"/></font></dxf>';
 const rules=`<conditionalFormatting sqref="A8:B55"><cfRule type="expression" dxfId="${count}" priority="${priority}"><formula>AND(ISNUMBER($B8),$B8&lt;2)</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="E14"><cfRule type="expression" dxfId="${count}" priority="${priority+1}"><formula>AND(ISNUMBER(E14),OR(E14&lt;3,E14&gt;3.6))</formula></cfRule></conditionalFormatting>`;
 if(!sheet.includes('<pageMargins'))throw Error('POOL_ALERT_LAYOUT_REQUIRED');
 parts.set(stylePath,Buffer.from(styles.replace(dxfs[0],`<dxfs count="${count+1}">${dxfs[1]}${font}</dxfs>`)));
 parts.set(sheetPath,Buffer.from(sheet.replace('<pageMargins',rules+'<pageMargins')));
 return [stylePath,sheetPath];
}

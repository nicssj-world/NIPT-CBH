/** Runtime-only alerts reference preserved calculated cells. Original fonts,
 * cell styles, formulas and Master bytes remain unchanged. */
export function poolingAlerts(parts:Map<string,Buffer>,values:Record<string,unknown>){
 if(!Object.keys(values).some(k=>/^slot\.\d+\.libraryQc$|^pool\.concentration$/.test(k)))return [];
 const stylePath='xl/styles.xml',sheetPath='xl/worksheets/sheet5.xml',styles=parts.get(stylePath)!.toString(),sheet=parts.get(sheetPath)!.toString();
 const dxfs=/<dxfs\b[^>]*>([\s\S]*?)<\/dxfs>/.exec(styles);if(!dxfs)throw Error('POOL_ALERT_STYLE_REQUIRED');
 const count=[...dxfs[1].matchAll(/<dxf\b/g)].length,priority=Math.max(0,...[...sheet.matchAll(/\bpriority="(\d+)"/g)].map(m=>Number(m[1])))+1;
 const font='<dxf><font><color rgb="FFFF0000"/></font></dxf>';
 // Owner 2026-11-11: a Volume below 2 µL also gets a light fill on Barcode, Sample ID and Volume (A:C), so it still shows when printed black and white.
 // Separate dxf and rule: the red font alone stays the style of the concentration check (F14).
 const fill='<dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf>';
 const rules=`<conditionalFormatting sqref="B8:C55"><cfRule type="expression" dxfId="${count}" priority="${priority}"><formula>AND(ISNUMBER($C8),$C8&lt;2)</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="F14"><cfRule type="expression" dxfId="${count}" priority="${priority+1}"><formula>AND(ISNUMBER(F14),OR(F14&lt;3,F14&gt;3.6))</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="A8:C55"><cfRule type="expression" dxfId="${count+1}" priority="${priority+2}"><formula>AND(ISNUMBER($C8),$C8&lt;2)</formula></cfRule></conditionalFormatting>`;
 if(!sheet.includes('<pageMargins'))throw Error('POOL_ALERT_LAYOUT_REQUIRED');
 parts.set(stylePath,Buffer.from(styles.replace(dxfs[0],`<dxfs count="${count+2}">${dxfs[1]}${font}${fill}</dxfs>`)));
 parts.set(sheetPath,Buffer.from(sheet.replace('<pageMargins',rules+'<pageMargins')));
 return [stylePath,sheetPath];
}

import {chromium} from 'playwright';
for(const channel of ['chrome','msedge',undefined]){try{const b=await chromium.launch({channel,headless:true});const p=await b.newPage();await p.goto('about:blank');
 const r=await p.evaluate(async()=>{if(!('BarcodeDetector' in window))return 'absent';try{return JSON.stringify(await BarcodeDetector.getSupportedFormats());}catch(e){return 'error '+e;}});console.log(channel??'bundled',r);await b.close();}catch(e){console.log(channel,'launch failed',String(e).slice(0,80));}}

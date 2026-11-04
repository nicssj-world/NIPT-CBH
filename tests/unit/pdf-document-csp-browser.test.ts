import {expect,it} from 'vitest';
import {chromium} from 'playwright';
import {NextRequest} from 'next/server';
import {proxy} from '../../src/proxy';

it('reproduces the inherited login CSP failure and fetches a preview after a fresh authenticated document',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  const origin='http://127.0.0.1:3100';
  await page.route(origin+'/**',route=>{
   const csp=proxy(new NextRequest(route.request().url())).headers.get('Content-Security-Policy')!;
   return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':csp},body:'<!doctype html><title>Synthetic PDF preview CSP</title>'});
  });
  const readPdf=()=>page.evaluate(async()=>{
   const url=URL.createObjectURL(new Blob(['%PDF-synthetic'],{type:'application/pdf'}));
   try {return await (await fetch(url)).text();}catch(e){return e instanceof Error?e.message:String(e);}finally{URL.revokeObjectURL(url);}
  });
  await page.goto(origin+'/login');
  await page.evaluate(()=>history.replaceState(null,'','/lab/batches/synthetic'));
  expect(await readPdf()).toBe('Failed to fetch');
  await Promise.all([page.waitForURL(origin+'/'),page.evaluate(()=>window.location.replace('/'))]);
  expect(await readPdf()).toBe('%PDF-synthetic');
 } finally {await browser.close();}
});

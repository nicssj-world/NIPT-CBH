import {it,expect} from "vitest";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {chromium,expect as browserExpect} from "@playwright/test";

it("actual toast stays above a modal, preserves focus, closes, resets and expires; mobile fits",async()=>{
 const component=fileURLToPath(new URL('../../src/components/shared/save-toast.tsx',import.meta.url));
 const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{SaveToast}from ${JSON.stringify(component)};createRoot(document.getElementById('root')).render(<SaveToast/>);`,loader:'tsx',resolveDir:process.cwd()},outfile:'toast-test.js',bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
 const browser=await chromium.launch();try{
  const page=await browser.newPage({viewport:{width:375,height:812}});await page.setContent('<style>:root{--color-surface:#fff;--color-ink:#182d42;--color-success:#1b6547;--color-muted:#4e6173;--color-canvas:#f3f6f8;--font-sans:sans-serif}</style><div id="root"></div><dialog><input aria-label="editing"/></dialog>');for(const file of bundle.outputFiles){if(file.path.endsWith('.css'))await page.addStyleTag({content:file.text});else await page.addScriptTag({content:file.text});}
  await browserExpect(page.locator('[popover]')).toHaveCount(1);await page.evaluate(()=>{document.querySelector('dialog')!.showModal();document.querySelector('input')!.focus();window.dispatchEvent(new Event('nipt:save-success'));});const toast=page.getByRole('status');await browserExpect(toast).toHaveText('บันทึกสำเร็จ');await browserExpect(page.getByLabel('editing')).toBeFocused();const box=await toast.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(375);
  // A real hit test proves this is above the dialog top layer, not only a high z-index.
  expect(await toast.evaluate(el=>{const b=el.getBoundingClientRect();return el.contains(document.elementFromPoint(b.x+20,b.y+20));})).toBe(true);
  await page.getByRole('button',{name:'ปิดแจ้งเตือนบันทึกสำเร็จ'}).click();await browserExpect(toast).not.toBeVisible();await page.mouse.move(0,0);await page.clock.install();await page.evaluate(()=>window.dispatchEvent(new Event('nipt:save-success')));await browserExpect(toast).toBeVisible();await page.evaluate(()=>document.querySelector('dialog')!.remove());await browserExpect(page.locator('body > [popover]')).toBeVisible();await page.clock.fastForward(2000);await page.evaluate(()=>window.dispatchEvent(new Event('nipt:save-success')));await page.clock.fastForward(1500);await browserExpect(toast).toBeVisible();await page.clock.fastForward(1600);await browserExpect(toast).not.toBeVisible();
 }finally{await browser.close();}
},30000);

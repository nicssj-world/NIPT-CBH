import {chromium,type Browser,type BrowserContextOptions,type LaunchOptions,type Page} from 'playwright';

// Starting Chromium costs seconds (much more on a busy or network-attached host), so the renderer keeps one browser per launch
// configuration and gives every render its own page. A render's pages are closed when it calls close(); the browser itself stays up,
// is relaunched if it dies, and is shut down after a quiet period.
const IDLE_MS=60*60*1000;
const shared=new Map<string,{browser:Promise<Browser>;active:number;idle?:NodeJS.Timeout}>();

export type RenderBrowser={newPage:(options?:BrowserContextOptions)=>Promise<Page>;close:()=>Promise<void>};

export async function launchShared(options:LaunchOptions):Promise<RenderBrowser>{
 const key=JSON.stringify(options);
 let entry=shared.get(key);
 if(!entry){
  const created={active:0,browser:chromium.launch(options)} as NonNullable<ReturnType<typeof shared.get>>;
  shared.set(key,created);entry=created;
  created.browser.then(b=>b.on('disconnected',()=>{if(shared.get(key)===created)shared.delete(key);}),()=>{if(shared.get(key)===created)shared.delete(key);});
 }
 const current=entry;
 let browser:Browser;
 try{browser=await current.browser;}catch(e){if(shared.get(key)===current)shared.delete(key);throw e;}
 if(!browser.isConnected()){if(shared.get(key)===current)shared.delete(key);return launchShared(options);}
 if(current.idle){clearTimeout(current.idle);current.idle=undefined;}
 current.active++;
 const pages=new Set<Page>();let released=false;
 return {
  newPage:async o=>{const page=await browser.newPage(o);pages.add(page);return page;},
  close:async()=>{
   if(released)return;released=true;
   await Promise.all([...pages].map(p=>p.close().catch(()=>undefined)));
   if(--current.active===0){
    current.idle=setTimeout(()=>{if(current.active===0){shared.delete(key);void browser.close().catch(()=>undefined);}},IDLE_MS);
    current.idle.unref();
   }
  },
 };
}

/** Launch options of the renderers; `gui` selects full Chromium on Windows (no console window per render). */
export const renderLaunchOptions=(gui=false):LaunchOptions=>({headless:true,...(gui&&process.platform==='win32'?{channel:'chromium'}:{}),args:process.env.CHROMIUM_NO_SANDBOX==='true'?['--no-sandbox']:[]});
/** Starts the browsers ahead of the first request so that nobody waits for a cold start. A failure is not fatal: the first render launches it. */
export async function warmUpRenderBrowsers(){
 for(const gui of [false,true])await launchShared(renderLaunchOptions(gui)).then(b=>b.close()).catch(()=>undefined);
}

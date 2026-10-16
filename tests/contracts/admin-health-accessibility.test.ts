import {it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
vi.mock('../../src/server/http',()=>({currentUser:async()=>({id:'00000000-0000-4000-8000-000000000001',roles:['APP_ADMIN'],unitIds:[],permissions:[]})}));
vi.mock('../../src/server/health',()=>({systemHealth:async()=>({
 technicalReady:false,runtimeMode:'operational',databaseMode:'operational',modeMatches:true,
 web:'ALIVE',postgresql:'ALIVE',renderer:'ALIVE',workerId:'operational-worker',Alive:true,
 LastSuccess:null,LastError:null,inboundEnabled:true,heartbeatAge:0,thresholds:{staleSeconds:90,backlogWarning:10},
 backlog:1,age:100,p6Retry:0,unresolvedReconciliation:0,migrationsMatch:true,quarantined:false,
 alerts:['QUEUE_STALE','SCAN_FAILURE'],backup:{warning:false,status:'NOT CONFIGURED',integrity:'NOT VERIFIED'},
 storage:{availableBytes:null,status:'NOT VERIFIED'}
})}));
import HealthPage from '../../src/app/(protected)/health/page';
it('real Health alert markup retains list semantics for assistive technology when warnings exist',async()=>{
 const html=renderToStaticMarkup(await HealthPage()),browser=await chromium.launch({headless:true});
 try{const context=await browser.newContext(),page=await context.newPage();await page.setContent('<html lang="th"><head><title>Local Health regression</title></head><body><main>'+html+'</main></body></html>');
  expect(await page.locator('ul li').count()).toBe(2);
  expect(await page.locator('ul li [role=alert]').allTextContents()).toEqual(['QUEUE_STALE','SCAN_FAILURE']);
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();expect(result.violations).toEqual([]);
 }finally{await browser.close();}
});

import {it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
vi.mock('next/navigation',()=>({useRouter:()=>({refresh(){}})}));
vi.mock('../../src/server/http',()=>({currentUser:async()=>({id:'00000000-0000-4000-8000-000000000001',roles:['APP_ADMIN'],unitIds:[],permissions:[]})}));
vi.mock('../../src/server/health',()=>({systemHealth:async()=>({
 technicalReady:false,runtimeMode:'operational',databaseMode:'operational',modeMatches:true,
 web:'ALIVE',postgresql:'ALIVE',renderer:'ALIVE',workerId:'operational-worker',Alive:true,
 LastSuccess:null,LastError:null,inboundEnabled:true,heartbeatAge:0,thresholds:{staleSeconds:90,backlogWarning:10},
 backlog:1,age:100,p6Retry:0,unresolvedReconciliation:0,migrationsMatch:true,quarantined:false,
 alerts:['QUEUE_STALE','HIS_SCAN_FAILURE'],backup:{warning:false,status:'NOT CONFIGURED',integrity:'NOT VERIFIED'},
 storage:{availableBytes:null,status:'NOT VERIFIED'}
}),operationsEvidence:async()=>({checkedAt:'2026-10-26T00:00:00.000Z',dbLatencyMs:1,
 inbound:{enabled:true,intervalSeconds:30,lastSuccess:null,lastError:'SHARE_PATH_NOT_FOUND',share:'DOWN',alive:true,healthy:false,readyBacklog:0,waitingOkOverdue:0},
 outbound:{configured:true,enabled:true,target:'AUTHORIZED_SHARE',written:0,pending:0,retry:0,attention:0,lastWritten:null,hisAck:'NOT_IMPLEMENTED'},
 queues:[{kind:'synthetic_scan',pending:1,oldest:null}],tls:{protocol:'https',validTo:null,daysLeft:200,subject:'127.0.0.1',error:null}})}));
import HealthPage from '../../src/app/(protected)/health/page';
it('real Health alert markup retains list semantics for assistive technology when warnings exist',async()=>{
 const html=renderToStaticMarkup(await HealthPage()),browser=await chromium.launch({headless:true});
 try{const context=await browser.newContext(),page=await context.newPage();await page.setContent('<html lang="th"><head><title>Local Health regression</title></head><body><main>'+html+'</main></body></html>');
  // Redesigned Health page (OWNER-LAB-059): alerts stay a real list, each item has a severity label, readable message and its code.
  const items=page.locator('ul.health-alerts > li');expect(await items.count()).toBe(2);
  expect(await items.locator('code').allTextContents()).toEqual(['QUEUE_STALE','HIS_SCAN_FAILURE']);
  expect((await items.locator('span').allTextContents()).every(t=>t.trim().length>0)).toBe(true);
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze();expect(result.violations).toEqual([]);
 }finally{await browser.close();}
});

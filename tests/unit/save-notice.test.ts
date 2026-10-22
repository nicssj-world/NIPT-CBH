import {afterEach,expect,it,vi} from "vitest";
import {notifySavedCommand,SAVE_NOTICE_EVENT} from "../../src/components/shared/save-notice";
import {api} from "../../src/components/p2/shared";
import {labApi} from "../../src/components/p4/lab-api";

afterEach(()=>vi.unstubAllGlobals());
function listen(){const window=new EventTarget(),saved=vi.fn();window.addEventListener(SAVE_NOTICE_EVENT,saved);vi.stubGlobal("window",window);vi.stubGlobal("document",{cookie:"nipt_csrf=test"});return saved;}
it("only saved commands notify; queries, previews, exports, connection tests and autosave stay quiet",()=>{
 const saved=listen();for(const action of ["query","preview","previewFill","previewAssign","export","exportSeqPair","pool","test","scan","saveRequest"]){notifySavedCommand("/api/test",{action});}notifySavedCommand("/api/test",undefined);expect(saved).not.toHaveBeenCalled();
 for(const action of ["save","saveDraft","updatePlan","recordActualPooling","review","recordQc4","edit","lockRequest"]){notifySavedCommand("/api/test",{action});}expect(saved).toHaveBeenCalledTimes(8);
 notifySavedCommand("/api/p5h/manual-stages/id",{stages:{}});notifySavedCommand("/api/p5h/manual-review/id",{version:1});notifySavedCommand("/api/settings/run-photo-storage",{action:"activate"});notifySavedCommand("/api/admin",{operation:"saveUnit"});expect(saved).toHaveBeenCalledTimes(12);
});
it.each([["ANC",api],["LAB",labApi]] as const)("%s helper waits for server success and never notifies on failed writes",async(_name,call)=>{
 const saved=listen();let finish!:(r:Response)=>void;vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;})));const pending=call("/api/test",{action:"saveDraft"});expect(saved).not.toHaveBeenCalled();finish(new Response('{}',{status:200}));await pending;expect(saved).toHaveBeenCalledTimes(1);
 vi.stubGlobal("fetch",vi.fn(async()=>new Response('{"code":"VERSION_CONFLICT","error":"conflict"}',{status:409})));await expect(call("/api/test",{action:"saveDraft"})).rejects.toThrow();expect(saved).toHaveBeenCalledTimes(1);
 vi.stubGlobal("fetch",vi.fn(async()=>new Response('{}',{status:200})));await call("/api/test");await call("/api/test",{action:"query"});await call("/api/test",{action:"saveRequest"});expect(saved).toHaveBeenCalledTimes(1);
 vi.stubGlobal("fetch",vi.fn(async()=>new Response('invalid response',{status:200})));await call("/api/test",{action:"saveDraft"}).catch(()=>undefined);expect(saved).toHaveBeenCalledTimes(1);
 vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error('NETWORK');}));await expect(call("/api/test",{action:"saveDraft"})).rejects.toThrow('NETWORK');expect(saved).toHaveBeenCalledTimes(1);
});

/** Stop accepting work before waiting for the in-flight archive operation. */
export function createArchiveRunner(run:()=>Promise<void>){
 let stopping=false,active:Promise<void>|null=null;
 return {
  cycle(){if(stopping||active)return Promise.resolve();const task=Promise.resolve().then(run);active=task;void task.finally(()=>{if(active===task)active=null;}).catch(()=>{});return task;},
  async stop(){stopping=true;if(active)await active;}
 };
}

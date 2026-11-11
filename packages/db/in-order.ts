/** Runs reads one after another on one client (a pg client must not run two queries at once; pg@9 removes the queueing). Typed like Promise.all. */
export async function inOrder<T extends unknown[]>(...steps:{[K in keyof T]:()=>Promise<T[K]>}):Promise<T>{
 const out:unknown[]=[];
 for(const step of steps)out.push(await step());
 return out as T;
}

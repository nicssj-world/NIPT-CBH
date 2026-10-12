/** Browser fixtures may mutate only the explicitly selected app browser database. */
export function browserFixtureDatabaseUrl(env:Record<string,string|undefined>=process.env):string {
 if(env.NIPT_MODE!=="synthetic")throw new Error("E2E_SYNTHETIC_MODE_REQUIRED");
 const fixture=env.NIPT_E2E_AUDIT_DATABASE_URL,app=env.DATABASE_URL;
 if(!fixture||!app)throw new Error("E2E_EXPLICIT_BROWSER_DATABASE_URLS_REQUIRED");
 const target=(raw:string)=>{
  let url:URL;try{url=new URL(raw);}catch{throw new Error("E2E_BROWSER_DATABASE_URL_INVALID");}
  if(!["postgres:","postgresql:"].includes(url.protocol)||!["127.0.0.1","localhost","[::1]"].includes(url.hostname)||url.search||url.hash)throw new Error("E2E_BROWSER_DATABASE_TARGET_UNSAFE");
  if(!/^\/(?:nipt_synthetic_ci|nipt_synthetic_p2_browser(?:_[a-z0-9]+)*)$/.test(url.pathname))throw new Error("E2E_RESERVED_BROWSER_DATABASE_REQUIRED");
  return {host:url.hostname,port:url.port||"5432",database:url.pathname};
 };
 const fixtureTarget=target(fixture),appTarget=target(app);
 if(fixtureTarget.host!==appTarget.host||fixtureTarget.port!==appTarget.port||fixtureTarget.database!==appTarget.database)throw new Error("E2E_BROWSER_DATABASE_APP_TARGET_MISMATCH");
 return fixture;
}

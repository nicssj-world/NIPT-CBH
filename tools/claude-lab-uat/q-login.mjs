// Refreshes cached sessions (%TEMP%/nipt-e2e-sessions.json) for the named synthetic users; avoids repeated logins (20 / 15 min throttle).
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
const O='https://127.0.0.1:20228',F=process.env.TEMP+'/nipt-e2e-sessions.json',cache=existsSync(F)?JSON.parse(readFileSync(F,'utf8')):{};
for(const u of process.argv.slice(2)){const c=cache[u];if(c){const r=await fetch(O+'/api/me',{headers:{cookie:c.jar.map(([k,v])=>`${k}=${v}`).join('; ')}});if(r.ok){console.log(u,'cached');continue;}}
 const jar=new Map();const eat=r=>{for(const x of r.headers.getSetCookie())jar.set(x.split('=')[0],x.split(';')[0].split('=').slice(1).join('='));};const ck=()=>[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
 const a=await fetch(O+'/api/auth/csrf');eat(a);const csrf=(await a.json()).csrf;const b=await fetch(O+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json',origin:O,cookie:ck()},body:JSON.stringify({username:u,password:u,csrf})});eat(b);if(!b.ok)throw new Error('login '+u+' '+b.status);
 const m=await fetch(O+'/api/me',{headers:{cookie:ck()}});eat(m);const j=await m.json();cache[u]={jar:[...jar],csrf:j.csrf,id:j.user?.id??j.id};console.log(u,'logged in');}
writeFileSync(F,JSON.stringify(cache));

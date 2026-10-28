import {it,expect} from 'vitest';
import {existsSync,readdirSync} from 'node:fs';
import path from 'node:path';

it('production standalone output never bundles patient data, local credentials, archives or test fixtures',()=>{
 const root=path.resolve('.next/standalone');
 if(!existsSync(path.join(root,'server.js')))throw Error('STANDALONE_BUILD_REQUIRED');
 const excludedDirs=new Set(['data','backups','tests','test-results','playwright-report','.git','.local','bundles']);
 const violations:string[]=[];
 const stack=[{absolute:root,rel:''}];let seen=0;
 while(stack.length){
  const {absolute,rel}=stack.pop()!;
  for(const item of readdirSync(absolute,{withFileTypes:true})){
   const next=rel?rel+'/'+item.name:item.name;
   seen++;if(seen>250000)throw Error('STANDALONE_INVENTORY_TOO_LARGE');
   if(item.name.startsWith('.env')||item.name==='migration-signing-private.pem'||item.name==='package-signing-private.pem')
    violations.push(next);
   if(item.isDirectory()){
    if(excludedDirs.has(item.name)&&next.split('/').length<=3){violations.push(next);continue;}
    stack.push({absolute:path.join(absolute,item.name),rel:next});
   }else if(item.isFile()&&/\.(pet|ok|res)$/i.test(item.name)){violations.push(next);}
  }
 }
 expect(violations).toEqual([]);
 expect(seen).toBeGreaterThan(10);
});

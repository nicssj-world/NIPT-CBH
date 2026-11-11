import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planRetention,MIN_KEEP} from '../../deploy/windows/retention.mjs';

const DAY=86400000,T0=Date.UTC(2026,10,1);
const item=(name,day,bytes=570_000_000)=>({name,modifiedMs:T0+day*DAY,bytes});
const releases=Array.from({length:10},(_,i)=>item(`1.1.2-r${String(i).padStart(2,'0')}`,i));

test('keeps the newest N and lists the rest oldest first, with the space it frees',()=>{
 const plan=planRetention({items:releases,keep:5});
 assert.deepEqual(plan.keep.map(k=>k.name),['1.1.2-r09','1.1.2-r08','1.1.2-r07','1.1.2-r06','1.1.2-r05']);
 assert.deepEqual(plan.remove.map(r=>r.name),['1.1.2-r00','1.1.2-r01','1.1.2-r02','1.1.2-r03','1.1.2-r04']);
 assert.equal(plan.reclaimBytes,5*570_000_000);
});
test('a protected release (installed, previous) is kept whatever its age, and is not counted against N',()=>{
 const plan=planRetention({items:releases,keep:3,protect:['1.1.2-r01','1.1.2-r00']});
 assert.deepEqual(plan.keep.map(k=>[k.name,k.reason]),[['1.1.2-r09','NEWEST'],['1.1.2-r08','NEWEST'],['1.1.2-r07','NEWEST'],['1.1.2-r01','PROTECTED'],['1.1.2-r00','PROTECTED']]);
 assert.deepEqual(plan.remove.map(r=>r.name),['1.1.2-r02','1.1.2-r03','1.1.2-r04','1.1.2-r05','1.1.2-r06']);
});
test('names compare case-insensitively (Windows), and a protected name that is not on disk is only reported',()=>{
 const plan=planRetention({items:releases,keep:3,protect:['1.1.2-R05','1.1.2-gone']});
 assert.ok(plan.keep.some(k=>k.name==='1.1.2-r05'&&k.reason==='PROTECTED'));
 assert.deepEqual(plan.protectedMissing,['1.1.2-gone']);
});
test('nothing is removed when there are no more than N items',()=>{
 const plan=planRetention({items:releases.slice(0,4),keep:5});
 assert.equal(plan.remove.length,0);assert.equal(plan.reclaimBytes,0);assert.equal(plan.keep.length,4);
 assert.deepEqual(planRetention({items:[],keep:3}).remove,[]);
});
test('the result does not depend on the order the folders were listed in, and ties fall back to the name',()=>{
 const same=['b','a','c','d'].map(n=>item(n,3));
 const one=planRetention({items:same,keep:3}),two=planRetention({items:[...same].reverse(),keep:3});
 assert.deepEqual(one,two);assert.deepEqual(one.remove.map(r=>r.name),['a']);
 assert.deepEqual(planRetention({items:[...releases].reverse(),keep:5}),planRetention({items:releases,keep:5}));
});
test(`N can never be below ${MIN_KEEP}, and must be a whole number`,()=>{
 for(const keep of [0,1,2,2.5,-1,Number.NaN,'5'])assert.throws(()=>planRetention({items:releases,keep}),/RETENTION_KEEP_TOO_SMALL/,String(keep));
});
test('refuses a name that could point outside the folder, a duplicate name and a broken item',()=>{
 for(const name of ['..','.','a/b','a\\b','C:x','a*b','',' '.repeat(0)])assert.throws(()=>planRetention({items:[item(name,1)],keep:3}),/RETENTION_NAME_INVALID/,JSON.stringify(name));
 assert.throws(()=>planRetention({items:[item('A',1),item('a',2)],keep:3}),/RETENTION_NAME_DUPLICATE/);
 assert.throws(()=>planRetention({items:[{name:'x',modifiedMs:1,bytes:-5}],keep:3}),/RETENTION_ITEM_INVALID/);
 assert.throws(()=>planRetention({items:null,keep:3}),/RETENTION_ITEMS_REQUIRED/);
});

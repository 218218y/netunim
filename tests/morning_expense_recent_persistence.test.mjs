import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updateExpenseRecentSnapshot,expenseRecentSnapshot} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-recent-model.js';
import {createExpenseRecent} from '../netunim-orders/site/assets/js/domains/finance/morning-expense-recent.js';
import {createRuntimeTaskOwner} from '../netunim-orders/site/assets/js/shared/runtime-task-owner.js';

const row = n => ({id:String(n),kind:'expense',status:10,type:305,createdAt:new Date(1700000000000+n*1000).toISOString(),number:'invoice-'+n});
const full = (items,at=100,startedAt=at-10) => ({kind:'full',items,at,startedAt});
test('full refresh replaces the entire prior snapshot, while new site intakes merge and retain account mode',()=>{
  let value = updateExpenseRecentSnapshot(null,full([row(1),row(2)]));
  value = updateExpenseRecentSnapshot(value,{kind:'record',items:[row(3)],at:110});
  assert.deepEqual(value.items.map(item=>item.id),['3','2','1']);assert.equal(value.mode,'account');assert.equal(value.readAt,100);
  value = updateExpenseRecentSnapshot(value,full([{...row(2),description:'corrected'}],140,130));
  assert.deepEqual(value.items.map(item=>item.id),['2']);assert.equal(value.items[0].description,'corrected');
  value = updateExpenseRecentSnapshot(value,{kind:'site',items:[row(1)],at:150});
  assert.equal(value.readAt,140);assert.equal(value.mode,'account');
});
test('concurrent site commits survive older scans; an older full scan cannot overwrite a newer refresh',()=>{
  let value = updateExpenseRecentSnapshot(null,full([row(1)]));
  value = updateExpenseRecentSnapshot(value,{kind:'record',items:[row(3)],at:120});
  value = updateExpenseRecentSnapshot(value,full([row(2)],140,110));
  assert.deepEqual(value.items.map(item=>item.id),['3','2']);
  assert.deepEqual(updateExpenseRecentSnapshot(value,full([row(1)],150,105)),value);
});
test('saved snapshots retain only ten projected display rows and reject corrupt data',()=>{
  let value = updateExpenseRecentSnapshot(null,full([{...row(1),url:'signed-secret',payload:{bank:'private'}}]));
  for(let n=2;n<30;n++) value = updateExpenseRecentSnapshot(value,{kind:'record',items:[row(n)],at:100+n});
  assert.equal(value.items.length,10);assert.ok(value.updates.length<=10);
  assert.ok(!JSON.stringify(value).includes('secret')&&!JSON.stringify(value).includes('private'));
  assert.deepEqual(expenseRecentSnapshot(value),value);
  assert.throws(()=>expenseRecentSnapshot({...value,items:[{...row(1),createdAt:''}]}));
});
test('reload restores a fully refreshed list and subsequent intakes without a provider scan or cache expiry',async()=>{
  globalThis.document={querySelector:()=>null};const stored=new Map();let calls=0,clock=1000;
  const cache={read:async scope=>structuredClone(stored.get(scope.owner+scope.environment)||null),update:async(scope,change,check)=>{
    check();const key=scope.owner+scope.environment,next=updateExpenseRecentSnapshot(stored.get(key),change);stored.set(key,next);return structuredClone(next);
  }};
  const caps={version:1,environment:'production',siteRecent:true},tasks=createRuntimeTaskOwner();let owner='first';
  const create=()=>createExpenseRecent({cache,accountId:()=>owner,capabilities:()=>caps,capture:()=>{const saved=owner;return()=>assert.equal(owner,saved);},
    run:tasks.run,now:()=>clock,request:async(action)=>{calls++;assert.equal(action,'expenses');return {...caps,page:0,pageSize:50,total:2,pages:1,items:[row(1),row(2)]};}});
  let recent=create();await recent.load();recent.record({verified:true,expenseId:'3',item:row(3)});await tasks.drain();
  recent.reset();clock+=365*86400000;recent=create();await recent.loadSite();
  assert.equal(calls,2);for(const n of [1,2,3])assert.ok(recent.markup().includes('invoice-'+n));assert.match(recent.markup(),/כל חשבון Morning/);
  owner='other';recent.reset();recent=create();caps.siteRecent=false;await recent.loadSite();assert.ok(!recent.markup().includes('invoice-3'));
  owner='first';caps.environment='sandbox';recent.reset();recent=create();await recent.loadSite();assert.ok(!recent.markup().includes('invoice-3'));
});
test('failed or cancelled full refresh preserves the saved snapshot; storage failure is visible',async()=>{
  globalThis.document={querySelector:()=>null};let stored=updateExpenseRecentSnapshot(null,full([row(1)])),failWrite=false,cancel=false,recent;
  const tasks=createRuntimeTaskOwner(),caps={version:1,environment:'production',siteRecent:true};
  recent=createExpenseRecent({cache:{read:async()=>stored,update:async(_,change)=>{if(failWrite)throw Error('disk full');stored=updateExpenseRecentSnapshot(stored,change);return stored;}},
    accountId:()=> 'owner',capabilities:()=>caps,capture:()=>()=>{},run:tasks.run,request:async()=>{if(cancel)recent.cancel();return {...caps,page:0,pageSize:50,total:1,pages:1,items:[row(2)]};}});
  await recent.loadSite();cancel=true;await recent.load();assert.equal(stored.items[0].id,'1');
  cancel=false;failWrite=true;await recent.load();assert.equal(stored.items[0].id,'1');assert.match(recent.markup(),/לא ניתן לשמור/);
});

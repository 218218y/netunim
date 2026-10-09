import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCalendarController} from '../netunim-orders/site/assets/js/domains/calendar/controller.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(t,phase){
  const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),doc=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:()=>null}});
  t.after(()=>{for(const [name,prior] of [['navigator',nav],['document',doc]]){if(prior)Object.defineProperty(globalThis,name,prior);else delete globalThis[name]}});
  const held=deferred(),entered=deferred(),again=deferred(),next=deferred(),queue=[],delivered=[],toasts=[];let reads=0,version=0,current=true,settled=true;
  if(phase.endsWith('error')){const prior=console.error;console.error=()=>{};t.after(()=>{console.error=prior})}
  const calendarSession={syncPromise:null,syncing:false,accountId:'A',expectedAccountId:'',lastSyncAt:null},calendarUi={focusDate:'2026-10-09',viewMode:'month',events:[],calendars:[],pending:[]};
  const controller=createDomainsCalendarController({ui:{currentView:'dashboard'},tab:{primaryTab:true},calendarUi,calendarSession,
    calendarAuth:{captureOperation:()=>({assertCurrent(){if(!current)throw Object.assign(Error('revoked'),{code:'CALENDAR_OPERATION_SCOPE_CHANGED'})}}),hasUsableToken:()=>current},
    calendarStorage:{connectionPreference:()=>({known:true,autoConnect:false,accountId:'A'}),getMeta:async()=> 'A',putMeta:async()=>{},saveConnectionPreference(){},listOperations:async()=>structuredClone(queue),
      readPendingSnapshot:async()=>{if(phase==='receipt-error')throw Error('queue read failed');const observed=version,operations=structuredClone(queue);if(phase==='receipt'&&reads===1){entered.resolve();await held.promise}return {operations,isCurrent:()=>settled&&version===observed,isSettled:()=>settled}},
      putRangeCache:async()=>{if(phase==='cache'&&reads===1){entered.resolve();await held.promise}}},
    calendarApi:{listCalendars:async()=>[{id:'A',primary:true,accessRole:'owner'}],fetchEvents:async()=>{reads++;if(reads===1&&phase==='events'){entered.resolve();await held.promise}if(reads===2){again.resolve();await next.promise}return []}},
    calendarJournal:{flushPending:async()=>{if(phase==='delivery-error')throw Error('unknown server response');delivered.push(...queue.splice(0).map(row=>row.eventId));version++}},toast:value=>toasts.push(value)});
  return {controller,calendarSession,calendarUi,toasts,delivered,entered,held,again,next,append(){queue.push({seq:1,eventId:'retained-ID',type:'insert',calendarId:'A',body:{id:'retained-ID',summary:'retained content'}});version++},beginWrite(){settled=false;version++},settleWrite(){settled=true;version++},revoke(){current=false},queue,reads:()=>reads};
}
for(const phase of ['events','cache','receipt'])test(`Calendar does not confirm complete sync when a durable event arrives during ${phase}`,async t=>{
  const f=fixture(t,phase),pending=f.controller.syncNow();await f.entered.promise;f.append();f.held.resolve();
  assert.equal(await pending,false);assert.equal(f.calendarSession.lastSyncAt,null);assert.equal(f.toasts.length,0);
  if(phase!=='receipt')assert.equal(f.calendarUi.pending[0]?.eventId,'retained-ID');
  await f.again.promise;const resumed=f.calendarSession.syncPromise;f.next.resolve();assert.equal(await resumed,true);
});
test('A clean Calendar queue still confirms success',async t=>{
  const f=fixture(t,'clean');assert.equal(await f.controller.syncNow(),true);assert.ok(f.calendarSession.lastSyncAt);assert.equal(f.reads(),1);
});
test('New durable pending work wakes its current owner after the existing task settles',async t=>{
  const f=fixture(t,'events'),pending=f.controller.syncNow();await f.entered.promise;f.append();f.held.resolve();await pending;
  // Delivery must be requested by the continuation, without waiting for a poll timer.
  await f.again.promise;
  assert.equal(f.reads(),2);assert.deepEqual(f.delivered,['retained-ID']);const resumed=f.calendarSession.syncPromise;f.next.resolve();assert.equal(await resumed,true);
});
test('Revocation retains new pending work and cancels its old-owner continuation',async t=>{
  const f=fixture(t,'events'),pending=f.controller.syncNow();await f.entered.promise;f.append();f.revoke();f.held.resolve();
  assert.equal(await pending,false);assert.equal(f.reads(),1);assert.equal(f.queue.length,1);assert.equal(f.toasts.length,0);
});
test('An unsettled local write blocks empty-queue success without spinning; its producer can wake after commit',async t=>{
  const f=fixture(t,'clean');f.beginWrite();assert.equal(await f.controller.syncNow(),false);
  assert.equal(f.reads(),1);assert.equal(f.calendarSession.lastSyncAt,null);assert.equal(f.toasts.length,0);
  f.append();f.settleWrite();f.next.resolve();assert.equal(await f.controller.syncNow(),true);
  assert.deepEqual(f.delivered,['retained-ID']);assert.equal(f.reads(),2);
});
for(const phase of ['delivery-error','receipt-error'])test(`Calendar ${phase} preserves failure semantics without an automatic retry`,async t=>{
  const f=fixture(t,phase);if(phase==='delivery-error')f.append();
  assert.equal(await f.controller.syncNow(),false);assert.equal(f.calendarSession.lastSyncAt,null);
  assert.equal(f.reads(),phase==='delivery-error'?0:1);assert.ok(f.calendarSession.lastError);
  if(phase==='delivery-error')assert.equal(f.queue[0]?.eventId,'retained-ID');
});

import {createCalendarBrowserEffects} from '../netunim-orders/site/assets/js/platform/calendar-browser-effects.js';
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
  const calendarSession={syncing:false,accountId:'A',expectedAccountId:'',lastSyncAt:null},calendarUi={focusDate:'2026-10-09',viewMode:'month',events:[],calendars:[],pending:[]};
  const controller=createDomainsCalendarController({effects:createCalendarBrowserEffects(),subscribeAccountScope:()=>()=>{},ui:{currentView:'dashboard'},tab:{primaryTab:true},calendarUi,calendarSession,
    calendarAuth:{captureOperation:()=>({owner:'fixture',assertCurrent(){if(!current)throw Object.assign(Error('revoked'),{code:'CALENDAR_OPERATION_SCOPE_CHANGED'})}}),hasUsableToken:()=>current},
    calendarStorage:{connectionPreference:()=>({known:true,autoConnect:false,accountId:'A'}),getMeta:async()=> 'A',putMeta:async()=>{},saveConnectionPreference(){},listOperations:async()=>structuredClone(queue),
      readPendingSnapshot:async()=>{if(phase==='receipt-error')throw Error('queue read failed');const observed=version,operations=structuredClone(queue);if(['receipt','foreign-receipt'].includes(phase)&&reads===1){entered.resolve();await held.promise}return {operations,isCurrent:()=>settled&&version===observed,isSettled:()=>settled}},
      confirmPendingSnapshot:async publish=>{
        if(phase==='confirmation-error')throw Error('confirmation read failed');
        const observed=version,result=publish({operations:structuredClone(queue),isCurrent:()=>settled&&version===observed,isSettled:()=>settled});
        if(phase==='confirmation-completion'){entered.resolve();await held.promise}
        return result;
      },
      putRangeCache:async()=>{if(phase==='cache'&&reads===1){entered.resolve();await held.promise}}},
    calendarApi:{listCalendars:async()=>[{id:'A',primary:true,accessRole:'owner'}],fetchEvents:async()=>{reads++;if(reads===1&&phase==='events'){entered.resolve();await held.promise}if(reads===2){again.resolve();await next.promise}return []}},
    calendarJournal:{flushPending:async()=>{if(phase==='delivery-error')throw Error('unknown server response');delivered.push(...queue.splice(0).map(row=>row.eventId));version++}},toast:value=>toasts.push(value)});
  return {controller,calendarSession,calendarUi,toasts,delivered,entered,held,again,next,append({foreign=false}={}){queue.push({seq:1,eventId:'retained-ID',type:'insert',calendarId:'A',body:{id:'retained-ID',summary:'retained content'}});if(!foreign)version++},beginWrite(){settled=false;version++},settleWrite(){settled=true;version++},revoke(){current=false},queue,reads:()=>reads};
}
test('A queue commit in another realm after the completed receipt read blocks sync success',async t=>{
  const f=fixture(t,'foreign-receipt'),pending=f.controller.syncNow();await f.entered.promise;f.append({foreign:true});f.held.resolve();
  assert.equal(await pending,false,'foreign commit must be seen without a local generation change');
  assert.equal(f.calendarSession.lastSyncAt,null);assert.equal(f.toasts.length,0);assert.equal(f.calendarUi.pending[0]?.eventId,'retained-ID');
  await f.again.promise;const resumed=f.controller.syncNow({quiet:true});f.next.resolve();assert.equal(await resumed,true);assert.deepEqual(f.delivered,['retained-ID']);
});
for(const phase of ['events','cache','receipt'])test(`Calendar does not confirm complete sync when a durable event arrives during ${phase}`,async t=>{
  const f=fixture(t,phase),pending=f.controller.syncNow();await f.entered.promise;f.append();f.held.resolve();
  assert.equal(await pending,false);assert.equal(f.calendarSession.lastSyncAt,null);assert.equal(f.toasts.length,0);
  if(phase!=='receipt')assert.equal(f.calendarUi.pending[0]?.eventId,'retained-ID');
  await f.again.promise;const resumed=f.controller.syncNow({quiet:true});f.next.resolve();assert.equal(await resumed,true);
});
test('A clean Calendar queue still confirms success',async t=>{
  const f=fixture(t,'clean');assert.equal(await f.controller.syncNow(),true);assert.ok(f.calendarSession.lastSyncAt);assert.equal(f.reads(),1);
});
test('New durable pending work wakes its current owner after the existing task settles',async t=>{
  const f=fixture(t,'events'),pending=f.controller.syncNow();await f.entered.promise;f.append();f.held.resolve();await pending;
  // Delivery must be requested by the continuation, without waiting for a poll timer.
  await f.again.promise;
  assert.equal(f.reads(),2);assert.deepEqual(f.delivered,['retained-ID']);const resumed=f.controller.syncNow({quiet:true});f.next.resolve();assert.equal(await resumed,true);
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
for(const phase of ['delivery-error','receipt-error','confirmation-error'])test(`Calendar ${phase} preserves failure semantics without an automatic retry`,async t=>{
  const f=fixture(t,phase);if(phase==='delivery-error')f.append();
  assert.equal(await f.controller.syncNow(),false);assert.equal(f.calendarSession.lastSyncAt,null);
  assert.equal(f.reads(),phase==='delivery-error'?0:1);assert.ok(f.calendarSession.lastError);
  if(phase==='delivery-error')assert.equal(f.queue[0]?.eventId,'retained-ID');
});
test('A revoked completion cannot return a former login confirmation',async t=>{
  const f=fixture(t,'confirmation-completion'),pending=f.controller.syncNow();await f.entered.promise;
  // Publication belonged to the then-current login. Its later completion must
  // not claim authority for the new login; display privacy is a separate owner.
  f.revoke();f.held.resolve();assert.equal(await pending,false);assert.equal(f.reads(),1);
});
test('A same-realm edit during confirmation completion wakes without accepting whole-head success',async t=>{
  const f=fixture(t,'confirmation-completion'),pending=f.controller.syncNow();await f.entered.promise;
  f.append();f.held.resolve();assert.equal(await pending,false);await f.again.promise;
  const resumed=f.controller.syncNow({quiet:true});f.next.resolve();assert.equal(await resumed,true);assert.deepEqual(f.delivered,['retained-ID']);
});

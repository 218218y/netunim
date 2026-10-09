import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarJournal} from '../netunim-orders/site/assets/js/calendar/journal.js';
import {createDomainsCalendarController} from '../netunim-orders/site/assets/js/domains/calendar/controller.js';
import {createCalendarAuth} from '../netunim-orders/site/assets/js/calendar/auth.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const changed=()=>Object.assign(Error('scope changed'),{code:'CALENDAR_OPERATION_SCOPE_CHANGED'});
test('Calendar journal cannot continue an old account after its durable queue read',async()=>{
  let current=true,deleted=0,sent=0;const held=deferred(),entered=deferred();
  const journal=createCalendarJournal({operationScope:{captureOperation:()=>({assertCurrent:()=>{if(!current)throw changed()}})},
    calendarStorage:{listOperations:()=>{entered.resolve();return held.promise},updateOperation:async()=>{},deleteOperation:async()=>{deleted++}},
    calendarApi:{insertEvent:async()=>{sent++}}});
  const outcome=journal.flushPending().then(()=>null,error=>error);await entered.promise;current=false;
  held.resolve([{seq:1,type:'insert',calendarId:'A',eventId:'stable-id',body:{id:'stable-id'}}]);
  assert.equal((await outcome)?.code,'CALENDAR_OPERATION_SCOPE_CHANGED');assert.equal(sent,0);assert.equal(deleted,0);
});
for(const phase of ['list','meta','journal','events','cache','resume'])test(`Calendar sync cannot publish success after account changes during ${phase}`,async t=>{
  const held=deferred(),entered=deferred();let current=true,toasts=0;
  const assertCurrent=()=>{if(!current)throw changed()};
  const step=async(name,value)=>{if((phase==='resume'?'events':phase)===name){entered.resolve();await held.promise}return value};
  const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),doc=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:()=>null}});
  t.after(()=>{for(const [name,prior] of [['navigator',nav],['document',doc]]){if(prior)Object.defineProperty(globalThis,name,prior);else delete globalThis[name]}});
  const calendarSession={syncPromise:null,syncing:false,accountId:'A',expectedAccountId:'',lastSyncAt:null},calendarUi={focusDate:'2026-10-09',viewMode:'month',events:[],calendars:[],pending:[]};
  const controller=createDomainsCalendarController({ui:{currentView:'dashboard'},tab:{primaryTab:true},calendarUi,calendarSession,
    calendarAuth:{captureOperation:()=>({assertCurrent}),hasUsableToken:()=>true,authRequiredError:()=>Error('auth'),restore:async()=> 'fixture'},
    calendarStorage:{connectionPreference:()=>({known:true,autoConnect:false,accountId:'A'}),getMeta:()=>step('meta','A'),putMeta:async()=>{},saveConnectionPreference(){},listOperations:()=>step('list',[]),putRangeCache:()=>step('cache',null)},
    calendarApi:{listCalendars:async()=>[{id:'A',primary:true,accessRole:'owner'}],fetchEvents:()=>step('events',[])},calendarJournal:{flushPending:()=>step('journal',0)},toast:()=>{toasts++}});
  const pending=(phase==='resume'?controller.resumeAfterCloudLogin():controller.syncNow()).catch(error=>{assert.equal(error.code,'CALENDAR_OPERATION_SCOPE_CHANGED');return false});await entered.promise;current=false;held.resolve();
  assert.equal(await pending,false);assert.equal(calendarSession.lastSyncAt,null);assert.equal(toasts,0);assert.equal(calendarSession.syncPromise,null);
});

test('A completed old sync cannot release the newer login task or busy flag',async t=>{
  let epoch=1,reads=0;const old=deferred(),oldEntered=deferred(),next=deferred(),nextEntered=deferred();
  const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),doc=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:()=>null}});
  t.after(()=>{for(const [name,prior] of [['navigator',nav],['document',doc]]){if(prior)Object.defineProperty(globalThis,name,prior);else delete globalThis[name]}});
  const calendarSession={syncPromise:null,syncing:false,accountId:'A',expectedAccountId:'',lastSyncAt:null},calendarUi={focusDate:'2026-10-09',viewMode:'month',events:[],calendars:[],pending:[]};
  const controller=createDomainsCalendarController({ui:{currentView:'dashboard'},tab:{primaryTab:true},calendarUi,calendarSession,
    calendarAuth:{captureOperation:()=>{const captured=epoch;return {assertCurrent(){if(captured!==epoch)throw changed()}}},hasUsableToken:()=>true},
    calendarStorage:{connectionPreference:()=>({known:true,autoConnect:false,accountId:'A'}),getMeta:async()=> 'A',putMeta:async()=>{},saveConnectionPreference(){},listOperations:async()=>[],putRangeCache:async()=>{nextEntered.resolve();await next.promise}},
    calendarApi:{listCalendars:async()=>[{id:'A',primary:true,accessRole:'owner'}],fetchEvents:async()=>{if(++reads===1){oldEntered.resolve();await old.promise}return []}},calendarJournal:{flushPending:async()=>0},toast(){}});
  const first=controller.syncNow();await oldEntered.promise;epoch++;
  const second=controller.syncNow();await nextEntered.promise;const promise=calendarSession.syncPromise;
  const coalesced=controller.syncNow();old.resolve();assert.equal(await first,false);
  assert.equal(calendarSession.syncing,true);assert.equal(calendarSession.syncPromise,promise);assert.equal(reads,2);
  next.resolve();assert.equal(await second,true);assert.equal(await coalesced,true);
  assert.equal(calendarSession.syncPromise,null);assert.equal(calendarSession.syncing,false);assert.ok(calendarSession.lastSyncAt);
});

test('Rejecting the wrong Google account still reports its error and retains the queue',async t=>{
  const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),doc=Object.getOwnPropertyDescriptor(globalThis,'document'),priorError=console.error;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:()=>null}});console.error=()=>{};
  t.after(()=>{console.error=priorError;for(const [name,prior] of [['navigator',nav],['document',doc]]){if(prior)Object.defineProperty(globalThis,name,prior);else delete globalThis[name]}});
  const calendarSession={accessToken:'',tokenExpiresAt:0,connected:false,accountVerified:false,accountId:'A',expectedAccountId:'',lastSyncAt:null},calendarUi={focusDate:'2026-10-09',viewMode:'month',events:[],calendars:[],pending:[]};
  const calendarAuth=createCalendarAuth({calendarSession,accountScope:()=>({owner:'fixture',epoch:1}),supaFetch:async()=>new Response(JSON.stringify({access_token:'fixture',expires_in:3600,account_id:'A'}))});
  await calendarAuth.restore();let delivered=0;
  const pending=[{seq:1,eventId:'retained',calendarId:'A',body:{id:'retained'}}];
  const controller=createDomainsCalendarController({ui:{currentView:'dashboard'},tab:{primaryTab:true},calendarUi,calendarSession,calendarAuth,
    calendarStorage:{connectionPreference:()=>({known:true,autoConnect:false,accountId:'A'}),listOperations:async()=>pending},
    calendarApi:{listCalendars:async()=>[{id:'B',primary:true,accessRole:'owner'}]},calendarJournal:{flushPending:async()=>{delivered++}},toast(){}});
  assert.equal(await controller.syncNow(),false);assert.equal(calendarAuth.hasUsableToken(),false);
  assert.ok(calendarSession.lastError.includes('Google'));assert.deepEqual(calendarUi.pending,pending);assert.equal(delivered,0);assert.equal(calendarSession.lastSyncAt,null);
});

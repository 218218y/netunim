import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCalendarController} from '../netunim-orders/site/assets/js/domains/calendar/controller.js';

test('a started Calendar owner observes committed peer work without starting Google delivery',async t=>{
  const prior={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator};
  globalThis.window=new EventTarget();globalThis.document=Object.assign(new EventTarget(),{querySelector:()=>null,visibilityState:'hidden'});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  t.after(()=>{globalThis.window=prior.window;globalThis.document=prior.document;Object.defineProperty(globalThis,'navigator',{configurable:true,value:prior.navigator})});
  let listener,subscriptions=0,delivered=0,reads=0;
  const queue=[],calendarSession={syncing:false,accountId:'A',accountVerified:false,lastSyncAt:null},calendarUi={focusDate:'2026-10-11',viewMode:'month',pending:[],events:[],calendars:[]};
  const snapshot={owner:'fixture',accountId:'A',calendars:[{id:'A',primary:true,accessRole:'owner'}],events:[],rangeStart:'2026-01-01',rangeEnd:'2027-01-01'};
  const receipt=()=>({operations:structuredClone(queue),isCurrent:()=>true,isSettled:()=>true});
  const controller=createDomainsCalendarController({ui:{currentView:'dashboard'},tab:{primaryTab:true},calendarSession,calendarUi,toast(){},subscribeAccountScope:()=>()=>{},
    subscribeCalendarCommits:fn=>{listener=fn;subscriptions++;return ()=>{listener=null;subscriptions--}},
    calendarAuth:{configured:()=>false,hasUsableToken:()=>true,captureOperation:()=>({owner:'fixture',assertCurrent(){}})},
    calendarApi:{listCalendars:async()=>snapshot.calendars,fetchEvents:async()=>[]},calendarJournal:{flushPending:async()=>{delivered++}},
    calendarStorage:{connectionPreference:()=>({known:true,autoConnect:false,accountId:'A'}),getMeta:async()=> 'A',putMeta:async()=>{},saveConnectionPreference(){},listOperations:async()=>structuredClone(queue),putRangeCache:async()=>{},readPendingSnapshot:async()=>receipt(),confirmPendingSnapshot:async publish=>publish(receipt()),readDisplaySnapshot:async()=>{reads++;return {snapshot,pending:structuredClone(queue)}}}});
  t.after(()=>controller.dispose());
  assert.equal(await controller.syncNow({quiet:true}),true);
  const confirmedAt=calendarSession.lastSyncAt;assert.equal(delivered,1);
  calendarSession.lastError='uncertain Google response';
  assert.equal(controller.start(),true);assert.equal(controller.start(),false);
  assert.equal(subscriptions,1,'the started owner must subscribe to peer commits');
  queue.push({seq:1,type:'insert',calendarId:'A',eventId:'peer-event',body:{id:'peer-event',summary:'durable peer event'}});
  listener();for(let i=0;i<12;i++)await Promise.resolve();
  assert.equal(calendarUi.pending[0]?.eventId,'peer-event');assert.ok(reads>0);
  assert.equal(delivered,1,'a notification is not permission to retry Google');
  assert.equal(calendarSession.lastSyncAt,confirmedAt,'a native queue read is not a Google ACK');
  assert.equal(calendarSession.lastError,'uncertain Google response','a local read must not clear a delivery error');
  controller.dispose();assert.equal(subscriptions,0);
});

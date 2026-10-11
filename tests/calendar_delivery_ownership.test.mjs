import test from 'node:test';
import assert from 'node:assert/strict';
import {createCalendarJournal} from '../netunim-orders/site/assets/js/calendar/journal.js';
import {createCalendarDeliveryOwner} from '../netunim-orders/site/assets/js/platform/calendar-delivery-owner.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
// One origin/physical queue, independent delivery clients. This fake only models
// exclusive ownership; queue and Google calls remain controlled by each test.
function owner(){
  let tail=Promise.resolve(),requests=0;
  const port=createCalendarDeliveryOwner({locks:{request(name,options,work){
    assert.equal(name,'netunim-orders-calendar-delivery');assert.equal(options.mode,'exclusive');
    requests++;const result=tail.then(()=>work({name}));
    tail=result.catch(()=>{});return result;
  }}});
  return {...port,get requests(){return requests}};
}
function queue(){
  const rows=[1,2].map(seq=>({seq,type:'patch',calendarId:'fixture-calendar',eventId:'same-event',body:{summary:seq===1?'old':'new'},attempts:0}));
  return {rows,async listOperations(){return structuredClone(rows)},async updateOperation(seq,patch){const row=rows.find(row=>row.seq===seq);if(row)Object.assign(row,patch)},async deleteOperation(seq){const index=rows.findIndex(row=>row.seq===seq);if(index>=0)rows.splice(index,1)}};
}
const authority={captureOperation:()=>({assertCurrent(){}})};
test('competing Calendar clients cannot apply an older patch after a newer queue acknowledgement',async()=>{
  const calendarStorage=queue(),deliveryOwner=owner(),held=deferred(),entered=deferred();let remote='initial',first=true;
  const a=createCalendarJournal({calendarStorage,deliveryOwner,operationScope:authority,calendarApi:{async patchEvent(_calendar,_id,body){
    if(first){first=false;entered.resolve();await held.promise;remote=body.summary;throw Error('response lost after remote effect')}
    remote=body.summary;
  }}});
  let bCalls=0;
  const b=createCalendarJournal({calendarStorage,deliveryOwner,operationScope:authority,calendarApi:{async patchEvent(_calendar,_id,body){bCalls++;remote=body.summary}}});
  const firstResult=a.flushPending().catch(error=>error);await entered.promise;
  const secondResult=b.flushPending();
  // Deterministic scheduling barrier, not a time delay. The old implementation
  // gets through the complete second flush while A is still awaiting Google.
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  if(deliveryOwner.requests===0)await secondResult; // before-fix: second client finishes before A settles
  const whileHeld=bCalls;
  held.resolve();const error=await firstResult;await secondResult;
  assert.deepEqual({whileHeld,remote,pending:calendarStorage.rows.length},{whileHeld:0,remote:'new',pending:0});
  assert.equal(error.message,'response lost after remote effect');
  assert.equal(bCalls,2);assert.equal(deliveryOwner.requests,2);
});

test('a delivery client rereads the durable queue after acquiring ownership',async()=>{
  const calendarStorage=queue(),deliveryOwner=owner(),held=deferred(),entered=deferred(),calls=[];
  const api={async patchEvent(_calendar,_id,body){calls.push(body.summary);if(calls.length===1){entered.resolve();await held.promise}}};
  const a=createCalendarJournal({calendarStorage,deliveryOwner,operationScope:authority,calendarApi:api});
  const b=createCalendarJournal({calendarStorage,deliveryOwner,operationScope:authority,calendarApi:api});
  const first=a.flushPending();await entered.promise;const second=b.flushPending();held.resolve();
  assert.equal(await first,2);assert.equal(await second,0);assert.deepEqual(calls,['old','new']);
});

test('queued former-login work cannot send or alter the durable queue when granted ownership',async()=>{
  const calendarStorage=queue(),deliveryOwner=owner(),held=deferred(),entered=deferred();let epoch=1,sent=0;
  const blocked=deliveryOwner.run(()=>{},async()=>{entered.resolve();await held.promise});await entered.promise;
  const journal=createCalendarJournal({calendarStorage,deliveryOwner,calendarApi:{async patchEvent(){sent++}},operationScope:{captureOperation(){const captured=epoch;return {assertCurrent(){if(captured!==epoch)throw Object.assign(Error('old login'),{code:'CALENDAR_OPERATION_SCOPE_CHANGED'})}}}}});
  const result=journal.flushPending().catch(error=>error),before=structuredClone(calendarStorage.rows);epoch++;held.resolve();await blocked;
  assert.equal((await result).code,'CALENDAR_OPERATION_SCOPE_CHANGED');assert.equal(sent,0);assert.deepEqual(calendarStorage.rows,before);
});

test('ownership includes local ACK settlement, and an aborted ACK replays the same queued identities',async()=>{
  const calendarStorage=queue(),deliveryOwner=owner(),held=deferred(),entered=deferred();let first=true,reads=0;
  const list=calendarStorage.listOperations;calendarStorage.listOperations=async()=>{reads++;return list()};
  const remove=calendarStorage.deleteOperation;calendarStorage.deleteOperation=async seq=>{if(first){first=false;entered.resolve();await held.promise;throw Error('IDB ACK aborted')}return remove(seq)};
  const calls=[],api={async patchEvent(_calendar,id,body){calls.push({id,summary:body.summary})}};
  const a=createCalendarJournal({calendarStorage,deliveryOwner,operationScope:authority,calendarApi:api}),b=createCalendarJournal({calendarStorage,deliveryOwner,operationScope:authority,calendarApi:api});
  const outcome=a.flushPending().catch(error=>error);await entered.promise;
  const next=b.flushPending();await Promise.resolve();await Promise.resolve();
  const beforeRelease={reads,calls:calls.length,pending:calendarStorage.rows.length};held.resolve();
  assert.equal((await outcome).message,'IDB ACK aborted');assert.equal(await next,2);
  assert.deepEqual(beforeRelease,{reads:1,calls:1,pending:2});
  assert.deepEqual(calls,[{id:'same-event',summary:'old'},{id:'same-event',summary:'old'},{id:'same-event',summary:'new'}]);
  assert.equal(calendarStorage.rows.length,0);
});

test('Calendar cannot bypass exclusive delivery when its ownership port is absent',()=>{
  assert.throws(()=>createCalendarJournal({calendarStorage:queue(),calendarApi:{},operationScope:authority}),/calendar_journal_delivery_owner_required/);
});
test('missing or refused native ownership retains pending work and sends nothing',async()=>{
  for(const locks of [null,{request:async(_name,_options,callback)=>callback(null)}]){
    const calendarStorage=queue(),before=structuredClone(calendarStorage.rows);let sent=0;
    const journal=createCalendarJournal({calendarStorage,deliveryOwner:createCalendarDeliveryOwner({locks}),operationScope:authority,calendarApi:{async patchEvent(){sent++}}});
    await assert.rejects(()=>journal.flushPending(),error=>error.code==='CALENDAR_DELIVERY_UNAVAILABLE');
    assert.equal(sent,0);assert.deepEqual(calendarStorage.rows,before);
  }
});
test('native lock errors are visible and cannot fall back to unowned delivery',async()=>{
  const failure=Error('native lock denied');let sent=0;
  const journal=createCalendarJournal({calendarStorage:queue(),deliveryOwner:createCalendarDeliveryOwner({locks:{request:async()=>{throw failure}}}),operationScope:authority,calendarApi:{async patchEvent(){sent++}}});
  await assert.rejects(()=>journal.flushPending(),error=>error===failure);assert.equal(sent,0);
});
test('delivery ownership releases after failures for 100 successive queue recoveries',async()=>{
  const deliveryOwner=owner();
  for(let cycle=0;cycle<100;cycle++){
    const calendarStorage=queue();let fail=true;
    const journal=createCalendarJournal({calendarStorage,deliveryOwner,operationScope:authority,calendarApi:{async patchEvent(){if(fail){fail=false;throw Error('offline')}}}});
    await assert.rejects(()=>journal.flushPending(),/offline/);assert.equal(calendarStorage.rows.length,2);
    assert.equal(await journal.flushPending(),2);assert.equal(calendarStorage.rows.length,0);
  }
  assert.equal(deliveryOwner.requests,200);
});

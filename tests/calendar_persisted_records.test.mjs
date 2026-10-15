import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeCalendarCommand,decodeCalendarRetryPatch,decodePersistedCalendarOperation,decodePersistedCalendarOperations,decodePersistedCalendarRange,decodeCalendarAccountMeta} from '../netunim-orders/site/assets/js/calendar/persisted-records.js';

const event={id:'stable-ID',summary:'retained text',start:{date:'2026-10-15'},end:{date:'2026-10-16'}};
const operation={seq:7,type:'insert',calendarId:'calendar-A',eventId:event.id,body:event};
const cache={key:'range',owner:'owner-A',accountId:'calendar-A',rangeStart:'2026-10-01',rangeEnd:'2026-11-01',fetchedAt:'2026-10-15T08:00:00.000Z',calendars:[{id:'calendar-A',accessRole:'reader',summary:'Calendar A'}],events:[{...event,_calendarId:'calendar-A',_calendarAccessRole:'reader'}]};
const invalid=error=>error?.code==='calendar_persisted_record_invalid';

test('Calendar persisted decoding retains IDs, outbound bytes and historical optional metadata',()=>{
  const before=structuredClone(operation),decoded=decodePersistedCalendarOperation(operation);
  assert.equal(decoded.seq,7);assert.equal(decoded.eventId,event.id);assert.equal(decoded.attempts,0);assert.equal(decoded.lastError,'');
  assert.equal(JSON.stringify(decoded.body),JSON.stringify(operation.body));assert.deepEqual(operation,before);
  decoded.body.summary='detached';assert.equal(operation.body.summary,'retained text');
  const patch={type:'patch',calendarId:'calendar-A',eventId:event.id,body:{summary:'new text',attendees:[],extendedProperties:{private:{keep:'value'}}}};
  assert.equal(JSON.stringify(decodeCalendarCommand(patch).body),JSON.stringify(patch.body));
  assert.deepEqual(decodePersistedCalendarOperations([{...operation,seq:9},operation]).map(row=>row.seq),[7,9]);
  assert.equal(decodeCalendarAccountMeta(null),'');assert.equal(decodeCalendarAccountMeta({key:'accountId',value:'calendar-A'}),'calendar-A');
});

for(const patch of [
  {seq:'7'},{seq:0},{seq:1.5},{seq:Infinity},{type:'replace'},{calendarId:[]},{calendarId:''},{eventId:7},{eventId:''},
  {attempts:'1'},{attempts:-1},{attempts:NaN},{lastError:false},{createdAt:'tomorrow'},{createdAt:'2026-02-30T08:00:00Z'},{lastAttemptAt:null},
  {body:null},{body:{...event,id:'different'}},{body:{...event,start:{date:'2026-02-30'}}},{body:{...event,summary:7}},
  {body:{...event,start:{date:'2026-10-17'}}},{body:{...event,end:{dateTime:'2026-10-16T09:00:00Z'}}},
])test(`Calendar rejects malformed persisted operation ${JSON.stringify(patch)}`,()=>{
  const raw={...structuredClone(operation),...patch},before=structuredClone(raw);
  assert.throws(()=>decodePersistedCalendarOperation(raw),invalid);assert.deepEqual(raw,before);
});
test('Calendar queue never filters malformed rows into a successful empty receipt',()=>{
  for(const raw of [null,{},[null],[operation,{...operation}],[operation,{...operation,seq:8,type:'unknown'}]])assert.throws(()=>decodePersistedCalendarOperations(raw),invalid);
  assert.throws(()=>decodeCalendarCommand({type:'delete',calendarId:'A',eventId:'E',body:{summary:'unexpected'}}),invalid);
  assert.throws(()=>decodeCalendarAccountMeta({key:'accountId',value:7}),invalid);
});
test('Calendar retry metadata cannot rewrite the queued identity or outbound payload',()=>{
  for(const patch of [{body:event},{eventId:'replacement'},{type:'delete'},{attempts:'1'},{lastError:7}])assert.throws(()=>decodeCalendarRetryPatch(patch),invalid);
  assert.deepEqual(decodeCalendarRetryPatch({attempts:2,lastError:'retry retained'}),{attempts:2,lastError:'retry retained'});
});

test('Calendar cache derives presentation authority from validated calendar-list evidence',()=>{
  const raw=structuredClone(cache);raw.events[0]._pending=true;raw.events[0]._pendingDelete=true;
  const decoded=decodePersistedCalendarRange(raw);
  assert.equal(decoded.events[0]._calendarAccessRole,'reader');assert.equal(decoded.events[0]._calendarSummary,'Calendar A');
  assert.equal(Object.hasOwn(decoded.events[0],'_pending'),false);assert.equal(Object.hasOwn(decoded.events[0],'_pendingDelete'),false);
  const historical=structuredClone(cache);delete historical.owner;
  assert.equal(decodePersistedCalendarRange(historical).owner,undefined);
});
for(const mutate of [
  row=>row.owner=7,row=>row.rangeStart='2026-02-30',row=>row.rangeEnd=row.rangeStart,row=>row.fetchedAt='tomorrow',
  row=>row.calendars[0].id=7,row=>row.calendars[0].accessRole=false,row=>row.calendars.push(row.calendars[0]),
  row=>row.events[0]._calendarId='foreign',row=>row.events[0]._calendarAccessRole='owner',row=>row.events[0].start.date='2026-02-30',
  row=>row.events.push(row.events[0]),row=>row.events[0]._calendarSummary={},
])test(`Calendar cache rejects malformed attribution or events: ${mutate}`,()=>{
  const raw=structuredClone(cache);mutate(raw);const before=structuredClone(raw);
  assert.throws(()=>decodePersistedCalendarRange(raw),invalid);assert.deepEqual(raw,before);
});

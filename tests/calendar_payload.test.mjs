import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeGoogleCalendar,decodeGoogleEvent,decodeCalendarPage,decodeEventPage,decodeEventReply,calendarErrorMessage} from '../netunim-orders/site/assets/js/calendar/payload.js';
import {createCalendarApi} from '../netunim-orders/site/assets/js/calendar/api.js';
import {createCalendarJournal} from '../netunim-orders/site/assets/js/calendar/journal.js';
const event={id:'exact-id',summary:'exact',description:'',location:'',start:{date:'2026-10-15'},end:{date:'2026-10-16'}};
const auth={captureOperation:()=>({assertCurrent(){},accessToken:()=> 'token'}),rejectToken(){}};
const invalid=error=>error.code==='calendar_invalid_payload';
for(const value of [null,[],false,5,'ok', {items:{}},{items:[null]},{items:[],nextPageToken:3},{items:[],error:{message:'failed'}}, {items:[{id:4,accessRole:'owner'}]}, {items:[{id:'a',primary:'true',accessRole:'owner'}]}])test('Calendar malformed page cannot authorize an empty/primary cache: '+JSON.stringify(value),()=>assert.throws(()=>decodeCalendarPage(value),invalid));
for(const changes of [{id:''},{summary:{}},{locked:'false'},{attendees:{}},{attendees:[null]},{start:null},{end:undefined},{start:{date:'2026-02-30'}},{end:{date:'2026-10-14'}},{end:{dateTime:'2026-10-16T12:00:00Z'}},{start:{date:'2026-10-15',dateTime:'2026-10-15T12:00:00Z'}},{start:{dateTime:'2026-10-15T25:00:00Z'}},{start:{dateTime:'2026-10-15T12:00:00'}},{error:{message:'failed'}}])test('Calendar malformed event cannot become permissions or ACK evidence: '+JSON.stringify(changes),()=>assert.throws(()=>decodeGoogleEvent({...event,...changes}),invalid));
test('valid empty lists, hidden/read-only calendars, sparse tombstones and future Google fields survive decoding',()=>{
 assert.deepEqual(decodeEventPage({}),{items:[],nextPageToken:''});assert.deepEqual(decodeCalendarPage({items:[]}),{items:[],nextPageToken:''});
 assert.deepEqual(decodeGoogleEvent({id:'deleted',status:'cancelled'}),{id:'deleted',status:'cancelled'});
 assert.deepEqual(decodeGoogleEvent({...event,start:{dateTime:'2026-10-15T12:00:00Z'},end:{dateTime:'2026-10-15T12:00:00Z'}}).start,{dateTime:'2026-10-15T12:00:00Z'});
 assert.equal(decodeGoogleEvent({...event,start:{dateTime:'2026-10-15T12:00:00',timeZone:'Asia/Tokyo'},end:{dateTime:'2026-10-15T09:00:00',timeZone:'Europe/Paris'}}).id,event.id);
 assert.equal(decodeGoogleCalendar({id:'deleted',deleted:true}).deleted,true);
 assert.equal(decodeGoogleCalendar({id:'hidden',hidden:true,accessRole:'future-role'}).accessRole,'future-role');
 const decoded=decodeGoogleEvent({...event,_calendarAccessRole:'owner',_pending:false,_pendingDelete:true,extendedProperties:{private:{tag:'retained'}}});
 assert.equal('_calendarAccessRole' in decoded,false);assert.equal('_pendingDelete' in decoded,false);assert.equal('_pending' in decoded,false);
 assert.deepEqual(decoded.extendedProperties,{private:{tag:'retained'}});assert.throws(()=>decodeEventReply(event,'other-id'),invalid);
 for(const boundary of [{dateTime:'2026-10-15T12:00:00+03:00'},{dateTime:'2026-10-15T12:00:00',timeZone:'Asia/Jerusalem'}])assert.deepEqual(decodeGoogleEvent({...event,start:boundary,end:{dateTime:'2026-10-15T23:00:00+03:00'}}).start,boundary);
 assert.equal(calendarErrorMessage({error:{message:{}}}),'');assert.equal(calendarErrorMessage({error:{message:'provider error'}}),'provider error');
});
for(const type of ['insert','patch','delete'])for(const reply of ['malformed-json','empty-object','wrong-id','error-envelope'])test(`real API + journal retains ${type} after ${reply}`,async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});
 const row={seq:7,type,calendarId:'primary',eventId:event.id,body:event,attempts:0};
 const storage={listOperations:async()=>[row],updateOperation:async(_seq,patch)=>Object.assign(row,patch),deleteOperation:async()=>{row.deleted=true}};
 globalThis.fetch=async()=>({ok:true,status:200,text:async()=>reply==='malformed-json'?'<html>':JSON.stringify(reply==='empty-object'?{}:reply==='wrong-id'?{...event,id:'other'}:{error:{message:'failed'}})});
 const journal=createCalendarJournal({calendarStorage:storage,calendarApi:createCalendarApi({calendarAuth:auth}),operationScope:auth,deliveryOwner:{run:async(assert,run)=>{assert();return run()}}});
 await assert.rejects(journal.flushPending(),invalid);assert.equal(row.deleted,undefined);assert.equal(row.attempts,1);assert.ok(row.lastError);
});
test('valid delete and HTTP failures retain 401/404/409 delivery meanings',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});let rejected=0;
 const api=createCalendarApi({calendarAuth:{...auth,rejectToken:()=>rejected++}});
 globalThis.fetch=async()=>new Response(null,{status:204});assert.equal(await api.deleteEvent('a','b'),null);
 for(const status of [401,404,409]){globalThis.fetch=async()=>new Response('<html>',{status});await assert.rejects(api.getEvent('a','b'),error=>error.status===status)}
 assert.equal(rejected,1);
});
test('repeated pagination is rejected without publishing a partial list',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({items:[],nextPageToken:'same-token'}))};
 await assert.rejects(createCalendarApi({calendarAuth:auth}).listCalendars(),invalid);assert.equal(calls,2);
});
test('one failed calendar joins held sibling reads and cannot start later calendars',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});let release,entered;const held=new Promise(done=>{release=done}),started=new Promise(done=>{entered=done});let calls=0,settled=false;
 globalThis.fetch=async()=>{const index=calls++;if(index===0)return new Response(JSON.stringify({items:{}}));entered();await held;return new Response(JSON.stringify({items:[event]}))};
 const action=createCalendarApi({calendarAuth:auth}).fetchEvents(Array.from({length:7},(_,index)=>({id:'calendar-'+index,accessRole:'reader'})),{timeMin:'a',timeMax:'b'}).catch(error=>{settled=true;throw error});
 await started;for(let n=0;n<15;n++)await Promise.resolve();assert.equal(settled,false);release();await assert.rejects(action,invalid);assert.equal(calls,4);
});
test('joined parallel failures preserve the first observed error rather than calendar index order',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original});let release,entered;const held=new Promise(done=>{release=done}),started=new Promise(done=>{entered=done});
 globalThis.fetch=async url=>{
  if(String(url).includes('/first-calendar/')){await held;return new Response(JSON.stringify({items:{}}))}
  entered();return new Response(JSON.stringify({error:{message:'first observed provider failure'}}),{status:503});
 };
 let settled=false;
 const action=createCalendarApi({calendarAuth:auth}).fetchEvents([{id:'first-calendar',accessRole:'reader'},{id:'second-calendar',accessRole:'reader'}],{timeMin:'a',timeMax:'b'}).catch(error=>{settled=true;throw error});
 await started;for(let n=0;n<15;n++)await Promise.resolve();assert.equal(settled,false);release();
 await assert.rejects(action,error=>error.status===503&&error.message==='first observed provider failure');
});

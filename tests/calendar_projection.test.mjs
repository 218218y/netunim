import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as model from '../netunim-orders/site/assets/js/domains/calendar/read-model.js';
import {projectCalendarPresentation} from '../netunim-orders/site/assets/js/domains/calendar/presentation.js';
import {createCalendarEditorPayload} from '../netunim-orders/site/assets/js/domains/calendar/editor-payload.js';
import * as view from '../netunim-orders/site/assets/js/calendar/view.js';
import {esc} from '../netunim-orders/site/assets/js/core/values.js';
import {baseline} from './calendar_projection_policy_fixture.mjs';
const source=Object.values(baseline.functions).map(value=>value.source).join('\n');
const now=new Date(2026,9,15,12);
function original(ports={}){
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now.getTime()]))}}
 return vm.runInNewContext(`
 const DEFAULT_EVENT_COLOR='#8f6d55',HEBREW_WEEKDAYS=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','שבת'];
 const monthFormatter=new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric'}),shortDateTimeFormatter=new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}),longDateFormatter=new Intl.DateTimeFormat('he-IL',{weekday:'long',day:'numeric',month:'long',year:'numeric'}),shortPeriodFormatter=new Intl.DateTimeFormat('he-IL',{day:'numeric',month:'long'}),fullPeriodFormatter=new Intl.DateTimeFormat('he-IL',{day:'numeric',month:'long',year:'numeric'});
 function pad(value){return String(value).padStart(2,'0')}
 ${source}
 ({${Object.keys(baseline.functions).join(',')}})
 `,{...view,esc,Date:FixedDate,calendarUi:{calendars:[]},...ports});
}
function json(value){return JSON.parse(JSON.stringify(value))}
const calendars=[{id:'main',primary:true,summary:'ראשי <main>',accessRole:'owner',backgroundColor:'#123456'},{id:'reader',summary:'קריאה',accessRole:'reader'}];
const base={id:'original',summary:'תור <&"',start:{date:'2026-10-14'},end:{date:'2026-10-17'},_calendarId:'main',_calendarAccessRole:'owner'};
test('readonly overlay, day boundaries and permission decisions match the immutable original matrix',()=>{
 const old=original();
 for(const role of ['owner','writer','reader','freeBusyReader','writerWithoutPrivateAccess','future-role'])for(const changes of [
  {},{eventType:'birthday'},{eventType:'outOfOffice'},{attendees:[{email:'test@example.test'}]},{locked:true},{visibility:'private'},{status:'cancelled'},{_pendingDelete:true},
  {start:{dateTime:'2026-10-14T23:30:00Z'},end:{dateTime:'2026-10-16T01:00:00Z'}},
 ]){
  const event={...base,...changes,_calendarAccessRole:role};
  assert.equal(model.editableEvent(event),old.editableEvent(event));assert.equal(model.eventReadOnlyReason(event),old.eventReadOnlyReason(event));
  for(const day of ['2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17']){
   assert.equal(model.eventOccursOnDay(event,day),old.eventOccursOnDay(event,day));assert.equal(model.eventTimeLabel(event,day),old.eventTimeLabel(event,day));
  }
  const snapshot={calendars,events:[event]},pending=[
   {type:'insert',calendarId:'main',eventId:'new',body:{...base,id:'new'},seq:2},
   {type:'patch',calendarId:'main',eventId:'original',body:{summary:'updated'},seq:3},
   {type:'patch',calendarId:'reader',eventId:'absent',body:{summary:'orphan',start:base.start,end:base.end},seq:4},
   {type:'delete',calendarId:'main',eventId:'original',seq:5}
  ];const before=JSON.stringify({snapshot,pending});
  assert.deepEqual(json(model.applyPending(snapshot,pending)),json(old.applyPending(snapshot,pending)));
  assert.equal(JSON.stringify({snapshot,pending}),before,'projection mutated durable input');
 }
});
for(const mode of ['month','week','day'])for(const online of [true,false])for(const connected of [true,false])for(const canCreate of [true,false])test(`Calendar ${mode} board/toolbar preserves output (${online}/${connected}/${canCreate})`,()=>{
 const range=view.calendarRangeFor('2026-10-15',mode),events=Array.from({length:15},(_,index)=>({...base,id:'event-'+index,summary:'name <& '+index,_pending:index%2===0,_pendingDelete:index===0}));
 const input={range,mode,events,cacheFetchedAt:'2026-10-14T12:00:00Z',online,connected,canCreate,now};
 const old=original({calendarUi:{displayEvents:events,cacheFetchedAt:input.cacheFetchedAt},calendarRange:()=>range,currentViewMode:()=>mode,effects:{isOnline:()=>online},connection:{hasUsableToken:()=>connected},primaryWritableCalendar:()=>canCreate});
 const actual=projectCalendarPresentation(input,{esc}),before=JSON.stringify(input);
 assert.equal(actual.body(),old.bodyMarkup());assert.equal(actual.toolbar(),old.toolbarMarkup());assert.equal(JSON.stringify(input),before);
});
test('editor payload/error ordering preserves all-day exclusivity, multi-day times, trimming and quick form policy',()=>{
 for(const allDay of [true,false])for(const endDate of ['2026-10-14','2026-10-15','2026-10-17',''])for(const summary of ['','  title <&  ']){
  const values={calendarSummary:summary,calendarStartDate:'2026-10-15',calendarEndDate:endDate,calendarAllDay:allDay,calendarStartTime:'10:30',calendarEndTime:'09:15',calendarDescription:'  detail  ',calendarLocation:'  place  ',calendarQuickSummary:summary,calendarQuickDate:'2026-10-15',calendarQuickStartTime:'10:30',calendarQuickEndTime:'11:30'};
  const field=selector=>({value:values[selector.slice(1)]??'',checked:values[selector.slice(1)]===true});
  const actual=createCalendarEditorPayload({field}),old=original({$:field});
  function outcome(read){try{return json(read())}catch(error){return {error:error.message}}}
  for(const name of ['readEditorPayload','readQuickEditorPayload'])assert.deepEqual(outcome(actual[name]),outcome(old[name]));
 }
});
test('readonly projections and parsing have no raw storage, provider, session or browser write authority',()=>{
 for(const name of ['read-model','presentation','editor-payload']){
  const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/calendar/'+name+'.js',import.meta.url),'utf8');
  for(const forbidden of ['fetch(','addOperation(','deleteOperation(','querySelector','calendarSession','localStorage','setTimeout','captureOperation','innerHTML'])assert.equal(source.includes(forbidden),false,`${name}: ${forbidden}`);
 }
});

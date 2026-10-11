import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeCalendarDisplay} from '../netunim-orders/site/assets/js/calendar/display-access.js';
import {createCalendarDisplayLifetime} from '../netunim-orders/site/assets/js/calendar/display-lifetime.js';

const snapshot={owner:'A',accountId:'google-A',calendars:[{id:'google-A'},{id:'other-calendar-A'}],events:[{id:'unchanged',summary:'exact content'}]};
const pending=[{seq:12,type:'insert',calendarId:'other-calendar-A',eventId:'stable-ID',body:{id:'stable-ID'}}];
test('Display receipt requires the app owner and Google queue account independently',()=>{
  assert.equal(authorizeCalendarDisplay(snapshot,pending,'google-A','B'),null);
  assert.equal(authorizeCalendarDisplay(snapshot,pending,'google-B','A'),null);
  assert.equal(authorizeCalendarDisplay(snapshot,pending,'google-A',''),null);
  assert.equal(authorizeCalendarDisplay({...snapshot,owner:undefined},pending,'google-A','A'),null);
});
test('Authorized offline display preserves queued IDs, content, and object identities',()=>{
  const display=authorizeCalendarDisplay(snapshot,pending,'google-A','A');
  assert.equal(display.snapshot,snapshot);assert.equal(display.pending[0],pending[0]);
  assert.deepEqual(pending[0],{seq:12,type:'insert',calendarId:'other-calendar-A',eventId:'stable-ID',body:{id:'stable-ID'}});
});
test('Unknown/malformed cache attribution or foreign pending cannot become a display grant',()=>{
  for(const value of [null,[],{}, {...snapshot,owner:1},{...snapshot,calendars:null},{...snapshot,events:null}])assert.equal(authorizeCalendarDisplay(value,pending,'google-A','A'),null);
  for(const rows of [null,[null],[{calendarId:'foreign-Google'}],[{calendarId:1}]])assert.equal(authorizeCalendarDisplay(snapshot,rows,'google-A','A'),null);
});
test('Calendar account invalidation aborts unaccepted confirmation and fences local async publication',()=>{
  let notify,invalidations=0,stopped=0;
  const display=createCalendarDisplayLifetime({captureOperation:()=>({owner:'A',assertCurrent(){}}),subscribeAccountScope:fn=>{notify=fn;return ()=>{stopped++}},onInvalidate:()=>{invalidations++}});
  const first=display.capture();notify();assert.equal(first.signal.aborted,true);assert.throws(first.assertCurrent,/authority changed/);
  const second=display.capture();assert.equal(second.signal.aborted,false);assert.equal(second.owner,'A');
  assert.equal(display.dispose(),true);assert.equal(display.dispose(),false);assert.equal(second.signal.aborted,true);assert.throws(second.assertCurrent,/authority changed/);
  notify();assert.equal(invalidations,2);assert.equal(stopped,1);
});
test('Calendar presentation lifetime keeps the underlying auth fence after capture',()=>{
  let current=true;
  const display=createCalendarDisplayLifetime({captureOperation:()=>({owner:'A',assertCurrent(){if(!current)throw Error('login changed')}}),subscribeAccountScope:()=>()=>{},onInvalidate:()=>{}});
  const authority=display.capture();current=false;assert.throws(authority.assertCurrent,/login changed/);display.dispose();
});

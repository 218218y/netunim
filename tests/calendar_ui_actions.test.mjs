import assert from 'node:assert/strict';
import {createUiActions} from '../netunim-orders/site/assets/js/ui/actions.js';

const calls=[];
const record=name=>(...args)=>calls.push([name,...args]);
const actions=createUiActions({
  calendarPrevMonth:record('prev'),
  calendarToday:record('today'),
  calendarNextMonth:record('next'),
  calendarRefresh:record('refresh'),
  calendarAuthAction:record('auth'),
  calendarNewEvent:record('new'),
  calendarOpenEvent:record('open'),
  calendarToggleAllDay:record('toggle'),
  calendarSaveEvent:record('save'),
  calendarDeleteEvent:record('delete'),
});

const element={dataset:{clickArg0:'calendar-key'}};
const event={};
for(const name of [
  'calendar-prev-month','calendar-today','calendar-next-month','calendar-refresh',
  'calendar-auth','calendar-new-event','calendar-new-day','calendar-open-event',
  'calendar-toggle-all-day','calendar-save-event','calendar-delete-event',
]){
  assert.equal(typeof actions[name],'function',`${name} must be registered`);
  actions[name](element,event);
}

assert.equal(calls.length,11);
assert.ok(calls.some(call=>call[0]==='auth'),'calendar auth action must be reachable');
assert.ok(calls.some(call=>call[0]==='new'&&call[1]==='calendar-key'),'day shortcut must preserve its date argument');
assert.ok(calls.some(call=>call[0]==='open'&&call[1]==='calendar-key'),'open action must preserve its event key');
assert.ok(calls.some(call=>call[0]==='save'&&call[1]==='calendar-key'),'save action must preserve its event key');
assert.ok(calls.some(call=>call[0]==='delete'&&call[1]==='calendar-key'),'delete action must preserve its event key');
console.log('CALENDAR UI ACTION TESTS PASSED');

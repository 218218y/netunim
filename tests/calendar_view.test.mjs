import assert from 'node:assert/strict';
import {calendarPrefetchRangeFor,calendarRangeContains,calendarRangeFor,moveFocusDate,normalizeFocusDate,normalizeViewMode} from '../netunim-orders/site/assets/js/calendar/view.js';

assert.equal(normalizeViewMode('garbage'),'week');
assert.equal(normalizeFocusDate('2026-02-30',new Date(2026,7,28)),'2026-08-28');
assert.equal(moveFocusDate('2026-01-31','month',1),'2026-02-28');
assert.equal(moveFocusDate('2024-01-31','month',1),'2024-02-29');
assert.equal(moveFocusDate('2026-08-28','week',1),'2026-09-04');
assert.equal(moveFocusDate('2026-08-28','day',-1),'2026-08-27');

const month=calendarRangeFor('2026-08-28','month');
assert.equal(month.days,42);
assert.equal(month.startKey,'2026-07-26');
assert.equal(month.endKey,'2026-09-06');
assert.equal(month.focusDate,'2026-08-28');

const week=calendarRangeFor('2026-08-28','week');
assert.equal(week.days,7);
assert.equal(week.startKey,'2026-08-23');
assert.equal(week.endKey,'2026-08-30');

const day=calendarRangeFor('2026-08-28','day');
assert.equal(day.days,1);
assert.equal(day.startKey,'2026-08-28');
assert.equal(day.endKey,'2026-08-29');

assert.equal(calendarRangeContains(month,week),true);
assert.equal(calendarRangeContains(month,day),true);
assert.equal(calendarRangeContains(week,month),false);
const prefetch=calendarPrefetchRangeFor('2026-08-28');
assert.equal(prefetch.startKey,'2026-06-28');
assert.equal(prefetch.endKey,'2026-10-11');
assert.equal(calendarRangeContains(prefetch,month),true);
assert.equal(calendarRangeContains(prefetch,calendarRangeFor('2026-09-28','month')),true);
assert.equal(calendarRangeContains(prefetch,calendarRangeFor('2026-07-28','month')),true);

console.log('CALENDAR VIEW TESTS PASSED');

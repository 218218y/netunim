import assert from 'node:assert/strict';
import {createCalendarStorage,selectCoveringRangeSnapshot} from '../netunim-orders/site/assets/js/calendar/storage.js';

const values=new Map();
globalThis.localStorage={
  getItem:key=>values.has(key)?values.get(key):null,
  setItem:(key,value)=>values.set(key,String(value)),
};

const storage=createCalendarStorage();
assert.deepEqual(storage.connectionPreference(),{known:false,autoConnect:false,accountId:''});
assert.equal(storage.saveConnectionPreference({autoConnect:true,accountId:'owner@example.com'}),true);
assert.deepEqual(storage.connectionPreference(),{known:true,autoConnect:true,accountId:'owner@example.com'});
assert.equal(storage.saveConnectionPreference({autoConnect:false,accountId:'owner@example.com'}),true);
assert.deepEqual(storage.connectionPreference(),{known:true,autoConnect:false,accountId:'owner@example.com'});

const snapshots=[
  {key:'wide-old',accountId:'owner@example.com',rangeStart:'2026-06-28',rangeEnd:'2026-10-11',fetchedAt:'2026-08-28T10:00:00.000Z'},
  {key:'month-new',accountId:'owner@example.com',rangeStart:'2026-07-26',rangeEnd:'2026-09-06',fetchedAt:'2026-08-28T11:00:00.000Z'},
  {key:'other-account',accountId:'other@example.com',rangeStart:'2026-01-01',rangeEnd:'2026-12-31',fetchedAt:'2026-08-28T12:00:00.000Z'},
];
assert.equal(selectCoveringRangeSnapshot(snapshots,{startKey:'2026-08-23',endKey:'2026-08-30',accountId:'owner@example.com'})?.key,'month-new');
assert.equal(selectCoveringRangeSnapshot(snapshots,{startKey:'2026-09-20',endKey:'2026-09-27',accountId:'owner@example.com'})?.key,'wide-old');
assert.equal(selectCoveringRangeSnapshot(snapshots,{startKey:'2026-11-01',endKey:'2026-11-02',accountId:'owner@example.com'}),null);
assert.equal(selectCoveringRangeSnapshot(snapshots,{startKey:'2026-08-23',endKey:'2026-08-30',accountId:'missing@example.com'}),null);
console.log('CALENDAR STORAGE TESTS PASSED');

import assert from 'node:assert/strict';
import {createCalendarStorage} from '../netunim-orders/site/assets/js/calendar/storage.js';

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
console.log('CALENDAR STORAGE TESTS PASSED');

import test from 'node:test';
import assert from 'node:assert/strict';
import {runCalendarTransaction,calendarRequestResult} from '../netunim-orders/site/assets/js/calendar/transaction.js';

function fixture(){
  let tx,aborts=0;const db={transaction:()=>tx={error:null,abort(){aborts++;queueMicrotask(()=>tx.onabort())}}};
  return {db,get tx(){return tx},get aborts(){return aborts}};
}
test('Calendar request success cannot complete a write before the native transaction receipt',async()=>{
  const f=fixture();let completed=false;
  const write=runCalendarTransaction(f.db,'queue','readwrite',()=>7).then(value=>{completed=true;return value});
  for(let i=0;i<10;i++)await Promise.resolve();assert.equal(completed,false);
  f.tx.oncomplete();assert.equal(await write,7);
});
test('Calendar transaction abort after successful request is a failure',async()=>{
  const f=fixture(),error=new DOMException('disk failed','AbortError');
  const write=runCalendarTransaction(f.db,'queue','readwrite',()=>7);await Promise.resolve();
  f.tx.error=error;f.tx.onabort();await assert.rejects(write,actual=>actual===error);
});
test('Calendar decoder failure aborts and joins the transaction without replacing the error',async()=>{
  const f=fixture(),error=Error('invalid persisted operation');
  await assert.rejects(runCalendarTransaction(f.db,'queue','readwrite',()=>{throw error}),actual=>actual===error);
  assert.equal(f.aborts,1);
});
test('Calendar request failure observes the eventual transaction abort too',async()=>{
  const f=fixture(),error=Error('request failed'),request={error};
  const write=runCalendarTransaction(f.db,'queue','readwrite',()=>calendarRequestResult(request));
  request.onerror();await assert.rejects(write,actual=>actual===error);assert.equal(f.aborts,1);
});

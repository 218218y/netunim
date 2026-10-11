import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmCalendarPendingSnapshot} from '../netunim-orders/site/assets/js/calendar/queue-confirmation.js';
import {createCalendarQueueObservation} from '../netunim-orders/site/assets/js/calendar/queue-observation.js';

// Model only IDB request/transaction event ordering, with an explicit active
// transaction interval. Native two-tab tests cover actual store serialization.
function database(rows,{abort=false,readError=false}={}){
  let tx,aborted=false;const persisted=structuredClone(rows),request={result:structuredClone(rows),error:null};
  return {persisted,request,get currentTransaction(){return tx},transaction(store,mode){
    assert.equal(store,'pending-operations');assert.equal(mode,'readonly');
    tx={active:false,error:null,abort(){aborted=true;queueMicrotask(()=>tx.onabort())},objectStore(name){
      assert.equal(name,'pending-operations');return {getAll(){
        queueMicrotask(()=>{
          if(abort){tx.error=Error('injected abort');tx.abort();return}
          if(readError){request.error=Error('injected read failure');request.onerror();tx.error=request.error;tx.abort();return}
          tx.active=true;request.onsuccess();tx.active=false;
          if(!aborted)queueMicrotask(()=>tx.oncomplete());
        });return request;
      }};
    }};return tx;
  }};
}
test('Calendar confirmation publishes the fresh queue synchronously inside a readonly transaction',async()=>{
  const rows=[{seq:7,eventId:'retained',body:{summary:'exact content'}}],db=database(rows),observation=createCalendarQueueObservation();let published=0;
  assert.equal(await confirmCalendarPendingSnapshot(db,observation,receipt=>{
    assert.equal(db.currentTransaction.active,true);assert.equal(receipt.isCurrent(),true);assert.deepEqual(receipt.operations,rows);published++;return receipt.operations.length===0;
  }),false);
  assert.equal(published,1);assert.deepEqual(db.persisted,rows);
});
test('A clean transaction confirms only after completion, with a live same-realm fence',async()=>{
  const db=database([]),observation=createCalendarQueueObservation();let published=false;
  const work=confirmCalendarPendingSnapshot(db,observation,receipt=>{published=true;return receipt.isCurrent()&&receipt.operations.length===0});
  assert.equal(published,false);assert.equal(await work,true);assert.equal(db.currentTransaction.active,false);
});
test('A same-realm write invalidates the transaction receipt until its next read',async()=>{
  const db=database([]),observation=createCalendarQueueObservation();
  const work=confirmCalendarPendingSnapshot(db,observation,receipt=>receipt.isCurrent());
  const settle=observation.beginWrite();settle();assert.equal(await work,false);
  assert.equal(await confirmCalendarPendingSnapshot(db,observation,receipt=>receipt.isCurrent()),true);
});
for(const fault of ['abort','readError'])test(`Calendar ${fault} rejects without publication or deleting pending`,async()=>{
  const rows=[{seq:9,eventId:'retained'}],db=database(rows,{[fault]:true});
  await assert.rejects(confirmCalendarPendingSnapshot(db,createCalendarQueueObservation(),()=>assert.fail('failed read publication')),/injected/);
  assert.deepEqual(db.persisted,rows);
});
test('Revocation during the confirmation callback preserves the exact error and rows',async()=>{
  const db=database([{seq:9,eventId:'retained'}]),error=Object.assign(Error('revoked'),{code:'CALENDAR_OPERATION_SCOPE_CHANGED'});
  await assert.rejects(confirmCalendarPendingSnapshot(db,createCalendarQueueObservation(),()=>{throw error}),actual=>actual===error);
  assert.deepEqual(db.persisted,[{seq:9,eventId:'retained'}]);
});
test('An asynchronous publication is a contract failure, never an accepted confirmation',async()=>{
  const db=database([]);
  await assert.rejects(confirmCalendarPendingSnapshot(db,createCalendarQueueObservation(),async()=>true),{message:'calendar_confirmation_must_be_synchronous'});
});
test('An invalid IDB result fails closed rather than substituting an empty queue',async()=>{
  const db=database(null);
  await assert.rejects(confirmCalendarPendingSnapshot(db,createCalendarQueueObservation(),()=>assert.fail()),{message:'calendar_pending_snapshot_invalid'});
});

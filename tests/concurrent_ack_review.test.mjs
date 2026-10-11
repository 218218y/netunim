import test from 'node:test';
import assert from 'node:assert/strict';
import {postAckFixture} from './post_ack_fixture.mjs';
import {sealStorageRecord} from '../shared/storage-journal-model.js';
async function blockedFixture(){
  const f=await postAckFixture('orders');
  const flight=await f.driver.materializeStorageV2CloudFlight();
  await f.driver.acknowledgeStorageV2CloudFlight(flight.operationId,11,f.project(f.model.state),{currentState:f.model.state,expectedSeq:1});
  f.setRemote({revision:11,state:f.project(f.model.state),updated_at:'2026-10-11T10:07:06Z'});
  for(let index=0;index<34;index++)await f.edit('pending-'+index,'retained-'+index);
  await f.driver.setStorageV2CloudControl({conflict:{kind:'concurrent-ack',domain:'orders',baseRevision:10,currentRemoteRevision:11}});
  return f;
}
test('Orders review retains all 34 pending operations and sends only the remaining work',async t=>{
  const f=await blockedFixture();t.after(()=>f.api.stopPolling());
  const before=await f.db.load(),review=await f.api.prepareConcurrentAckRecovery();
  assert.equal(review.pendingCount,34);assert.equal(review.ackSeq,1);assert.equal(review.revision,11);
  assert.deepEqual(await f.db.load(),before,'preparation is read-only');
  assert.deepEqual(review.backup.storage,before);
  assert.equal(await review.resume(),true);assert.equal(f.calls.length,1);
  const after=await f.db.load(),head=await f.runtime.cloudState();
  assert.deepEqual(after.journal,before.journal);assert.equal(head.base.ackSeq,35);assert.equal(head.control,null);assert.equal(head.flight,null);assert.equal(head.pending,false);
  assert.equal((await f.runtime.recoverReadOnly()).state.notes.length,35);assert.deepEqual(f.calls[0].snapshot.notes,f.model.state.notes);
  assert.equal(f.session.cloudUpdatedAt,'2026-10-11T10:07:06Z');
});
for(const failure of ['remote-advanced','remote-body','local-edit','login','primary','control-changed','transaction-abort','older-review'])test(`Orders pending review fails closed: ${failure}`,async t=>{
  const f=await blockedFixture();t.after(()=>f.api.stopPolling());
  const review=await f.api.prepareConcurrentAckRecovery();
  if(failure==='remote-advanced')f.setRemote({revision:12,state:f.project(f.model.state)});
  if(failure==='remote-body')f.setRemote({revision:11,state:f.project(f.model.state)});
  if(failure==='local-edit')await f.edit('after-review','newest-value');
  if(failure==='login')f.changeLogin();
  if(failure==='primary')f.tab.primaryTab=false;
  if(failure==='control-changed')await f.driver.setStorageV2CloudControl({conflict:{kind:'real-business-conflict',domain:'orders'}});
  if(failure==='transaction-abort')f.wrapped.commitCloudRecovery=async()=>{throw new DOMException('controlled abort','AbortError')};
  if(failure==='older-review')await f.api.prepareConcurrentAckRecovery();
  const before=await f.db.load();
  await assert.rejects(review.resume());assert.deepEqual(await f.db.load(),before);assert.equal(f.calls.length,0);
  assert.ok((await f.db.load()).controls);assert.ok(!f.statuses.some(args=>args.includes('synced')));
});
test('Orders reviewed control cannot resume another conflict kind or unsaved projection',async()=>{
  const f=await blockedFixture();
  f.model.state.notes[0].content='not-durable';const before=await f.db.load();
  await assert.rejects(f.api.prepareConcurrentAckRecovery(),/orders_recovery_unsaved_view/);assert.deepEqual(await f.db.load(),before);
});
test('Orders review must prove that pending replay from the authoritative base explains the checkpoint',async()=>{
  const f=await blockedFixture(),stored=await f.db.load(),data=structuredClone(stored.checkpoints.data);
  data.seq=stored.metadata.seq;data.state=structuredClone(f.model.state);delete data.state.checks;
  data.state.notes.push({id:'unexplained-checkpoint-record',content:'not in pending journal'});
  await f.db.replaceCheckpoint(f.runtime.cloudScope.owner,stored.metadata.epoch,stored.metadata.writer,sealStorageRecord(data,{kind:'checkpoint'}));
  f.model.state=(await f.runtime.recoverReadOnly()).state;
  const before=await f.db.load();
  await assert.rejects(f.api.prepareConcurrentAckRecovery(),/orders_recovery_journal_mismatch/);
  assert.deepEqual(await f.db.load(),before);assert.equal(f.calls.length,0);
});

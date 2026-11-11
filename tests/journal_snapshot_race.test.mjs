import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageJournal} from '../shared/storage-journal.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';
import {postAckFixture} from './post_ack_fixture.mjs';

test('a commit retiring emergency evidence during an IDB read cannot create a false journal gap',async()=>{
  const db=memoryDb(),emergency=emergencyStore();
  const journal=createStorageJournal({owner:'snapshot:orders',schema:{collections:['notes']},validate:()=>{},db,emergency});
  await journal.initializeCloudHead(10,{notes:[]});
  const load=db.load,append=db.append;
  let release,pending;
  const gate=new Promise(resolve=>{release=resolve});
  const put=(id)=>journal.append([{type:'put',collection:'notes',id,mode:'insert',index:0,record:{id,content:id}}]);
  db.append=async(...args)=>{if(args[3].data.seq===2)await gate;return append(...args)};
  db.load=async()=>{
    const captured=await load();db.load=load;
    await put('committed-after-snapshot').committed;
    pending=put('still-in-emergency').committed;
    return captured;
  };
  try{
    // Recovery may return the older coherent snapshot. Its caller must still
    // check the generation before publication. It must never invent a gap.
    const recovered=await journal.recover();
    assert.equal(recovered.seq,0);assert.deepEqual(recovered.state.notes,[]);
  }finally{release();await pending}
  const recovered=await journal.recover();
  assert.equal(recovered.seq,2);assert.equal(recovered.state.notes.length,2);
});

for(const app of ['orders','kupa'])test(`${app}: a temporarily undurable recovery read retries without resending the ACK`,async t=>{
  const f=await postAckFixture(app,{onCommitted:f=>f.edit('late-note','retained')});
  t.after(()=>f.api.stopPolling?.());
  const read=f.driver.readStorageV2CloudRecovery;let reads=0;
  f.driver.readStorageV2CloudRecovery=async(...args)=>{
    if(++reads===1)throw new Error('storage_cloud_recovery_undurable');
    return read(...args);
  };
  assert.equal(await f.save(),true);
  const head=await f.runtime.cloudState();
  assert.equal(reads,2);assert.equal(head.control,null);assert.equal(head.pending,false);
  assert.equal(head.base.ackSeq,2);assert.equal(f.calls.length,2);
  assert.equal(new Set(f.calls.map(call=>call.operationId)).size,2);
  assert.deepEqual((await f.runtime.recoverReadOnly()).state.notes,f.model.state.notes);
});

for(const message of ['storage_checksum_mismatch','storage_journal_gap_or_duplicate','storage_cloud_recovery_sequence','controlled disk read failure'])test(`recovery read preserves review fence for ${message}`,async()=>{
  const f=await postAckFixture('orders',{onCommitted:f=>f.edit('late-note','retained')});
  let reads=0;
  f.driver.readStorageV2CloudRecovery=async()=>{reads++;throw new Error(message)};
  assert.equal(await f.save(),false);assert.equal(reads,1);assert.equal(f.calls.length,1);
  const head=await f.runtime.cloudState();
  assert.equal(head.control.conflict.kind,'concurrent-ack');
  assert.equal(head.control.conflict.recoveryTrace.at(-1).reason,'journal_read_failed');
  assert.equal(head.base.ackSeq,1);assert.equal(head.pending,true);
  assert.equal((await f.runtime.recoverReadOnly()).state.notes.at(-1).content,'retained');
  f.api.stopPolling();
});

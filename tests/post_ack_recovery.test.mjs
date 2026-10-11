import test from 'node:test';
import assert from 'node:assert/strict';
import {postAckFixture} from './post_ack_fixture.mjs';
for(const app of ['orders','kupa'])for(const remoteChange of [false,true])test(`${app}: committed ACK plus a later edit drains without a permanent conflict (remote addition=${remoteChange})`,async()=>{
  const f=await postAckFixture(app,{remoteChange,onCommitted:f=>f.edit('new-note','late-local-value')});
  assert.equal(await f.save(),true);
  const recovered=await f.runtime.recoverReadOnly(),head=await f.runtime.cloudState();
  assert.equal(head.control,null);assert.equal(head.flight,null);assert.equal(head.pending,false);assert.equal(head.base.ackSeq,2);
  assert.deepEqual(recovered.state.notes,f.model.state.notes);
  assert.ok(recovered.state.notes.some(note=>note.id==='new-note'&&note.content==='late-local-value'));
  if(remoteChange)assert.ok(recovered.state.notes.some(note=>note.id==='remote-note'&&note.content==='remote-only'));
  assert.equal(f.calls.length,2);assert.notEqual(f.calls[0].operationId,f.calls[1].operationId);
  assert.deepEqual(f.calls[1].snapshot.notes,recovered.state.notes);
});
for(const app of ['orders','kupa']){
  test(`${app}: a real post-ACK record conflict retains local work and review fence`,async()=>{
    const f=await postAckFixture(app,{remoteEdit:'remote-value',onCommitted:f=>f.edit('original-note','late-local-value')});
    assert.equal(await f.save(),false);
    const head=await f.runtime.cloudState(),recovered=await f.runtime.recoverReadOnly();
    assert.equal(f.calls.length,1);assert.equal(head.base.ackSeq,1);assert.equal(head.pending,true);assert.equal(head.control.conflict.kind,'concurrent-ack');
    assert.equal(recovered.state.notes[0].content,'late-local-value');assert.equal(f.model.state.notes[0].content,'late-local-value');
  });
  test(`${app}: another append immediately before recovery CAS is retried from the actual head`,async()=>{
    let recoveries=0;
    const f=await postAckFixture(app,{remoteChange:true,onCommitted:f=>f.edit('new-note','late-local-value'),onRecovery:async f=>{if(++recoveries===1)await f.edit('third-note','another-late-value')}});
    assert.equal(await f.save(),true);assert.equal(recoveries,2);assert.equal((await f.runtime.cloudState()).base.ackSeq,3);
    assert.deepEqual((await f.runtime.recoverReadOnly()).state.notes,f.model.state.notes);assert.ok(f.model.state.notes.some(note=>note.id==='third-note'));
  });
  test(`${app}: continuous writes bound immediate recovery and preserve all work`,async()=>{
    let recoveries=0;
    const f=await postAckFixture(app,{onCommitted:f=>f.edit('new-note','late-local-value'),onRecovery:f=>f.edit(`late-${++recoveries}`,'retained')});
    assert.equal(await f.save(),false);assert.equal(recoveries,2);assert.equal(f.calls.length,1);
    const head=await f.runtime.cloudState();assert.equal(head.seq,4);assert.equal(head.base.ackSeq,1);assert.equal(head.pending,true);
    assert.deepEqual((await f.runtime.recoverReadOnly()).state.notes,f.model.state.notes);
  });
  test(`${app}: staged but unjournaled edits cannot clear the ACK review fence`,async()=>{
    const f=await postAckFixture(app,{onCommitted:f=>{f.model.state.notes[0].content='draft-not-durable';f.session.localGeneration++}});
    assert.equal(await f.save(),false);assert.equal(f.calls.length,1);assert.equal((await f.runtime.cloudState()).control.conflict.kind,'concurrent-ack');
    assert.equal((await f.runtime.recoverReadOnly()).state.notes[0].content,'flight-value');assert.equal(f.model.state.notes[0].content,'draft-not-durable');
  });
  test(`${app}: login epoch changes during recovery cannot publish or clear/write control`,async()=>{
    const f=await postAckFixture(app,{onCommitted:f=>f.edit('new-note','late-local-value'),onRecovery:f=>f.changeLogin()});
    assert.equal(await f.save(),false);assert.equal(f.calls.length,1);assert.equal((await f.runtime.cloudState()).control,null);
    assert.ok(f.model.state.notes.some(note=>note.id==='new-note'));assert.ok(!f.statuses.some(args=>args.includes('synced')));
  });
  test(`${app}: an explicit delete during ACK survives recovery and reaches the follow-up flight`,async()=>{
    const f=await postAckFixture(app,{remoteChange:true,onCommitted:f=>f.edit('original-note','',{remove:true})});
    assert.equal(await f.save(),true);assert.equal(f.model.state.notes.some(note=>note.id==='original-note'),false);
    assert.equal((await f.runtime.recoverReadOnly()).state.notes.some(note=>note.id==='original-note'),false);assert.ok(f.model.state.notes.some(note=>note.id==='remote-note'));
  });
}

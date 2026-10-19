import test from 'node:test';
import assert from 'node:assert/strict';
import {postAckFixture} from './post_ack_fixture.mjs';
import {createMainSaveOperation} from '../netunim-orders/site/assets/js/sync/save-operation.js';
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
    assert.equal(await f.save(),false);assert.equal(recoveries,app==='orders'?6:2);assert.equal(f.calls.length,1);
    const head=await f.runtime.cloudState();assert.equal(head.seq,2+recoveries);assert.equal(head.base.ackSeq,1);assert.equal(head.pending,true);
    if(app==='orders')assert.equal(head.control.conflict.recoveryTrace.at(-1).reason,'bounded_retry_exhausted');
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

test('orders: five successive edits to one note settle after both immediate CAS attempts lose their generation',async()=>{
  let recoveries=0;
  const f=await postAckFixture('orders',{composed:true,remoteChange:true,onCommitted:f=>f.edit('original-note','typing-1'),onRecovery:async f=>{
    recoveries++;
    if(recoveries<=2){await f.edit('original-note','typing-'+(recoveries*2));await f.edit('original-note','typing-'+(recoveries*2+1))}
  }});
  assert.equal(await f.save(),true);assert.equal(recoveries,3);
  const head=await f.runtime.cloudState();assert.equal(head.seq,6);assert.equal(head.base.ackSeq,6);assert.equal(head.control,null);
  assert.equal(f.model.state.notes.find(note=>note.id==='original-note').content,'typing-5');
  assert.equal(f.calls.length,2);assert.equal(new Set(f.calls.map(call=>call.operationId)).size,2);
  assert.deepEqual((await f.runtime.recoverReadOnly()).state.notes,f.model.state.notes);
  await f.api.quiesceForStorageCutover();assert.equal(f.api.runtime.isPending(),false);
});

for(const fault of ['draft','login','leadership','stop','storage','third-race'])test(`orders: deferred recovery retains all fences (${fault})`,async()=>{
  let recoveries=0,wake=null;
  const f=await postAckFixture('orders',{onCommitted:f=>f.edit('original-note','typing-1'),onRecovery:async f=>{
    recoveries++;
    if(recoveries<=2){await f.edit('original-note','typing-'+(recoveries+1));if(recoveries===2&&['draft','login','leadership','stop'].includes(fault))wake=setTimeout(()=>{
      if(fault==='draft'){f.model.state.notes[0].content='undurable';f.session.localGeneration++}
      if(fault==='login')f.changeLogin();
      if(fault==='leadership')f.tab.primaryTab=false;
      if(fault==='stop')f.api.stopPolling();
    },10)}
    else if(fault==='storage')throw new Error('controlled checkpoint failure');
    else if(fault==='third-race'&&recoveries===3)await f.edit('original-note','third-race-retained');
  }});
  try{
    assert.equal(await f.save(),fault==='third-race');
    if(fault==='leadership')f.tab.primaryTab=true;
    const head=await f.runtime.cloudState(),durable=await f.runtime.recoverReadOnly();
    assert.equal(f.calls.length,fault==='third-race'?2:1);
    assert.deepEqual(durable.state.notes,fault==='draft'?f.calls[0].snapshot.notes.map(note=>({...note,content:'typing-3'})):f.model.state.notes);
    if(['login','leadership'].includes(fault))assert.equal(head.control,null);
    else if(fault==='third-race'){assert.equal(head.control,null);assert.equal(head.base.ackSeq,head.seq);assert.equal(recoveries,4)}
    else{
      assert.equal(head.control.conflict.kind,'concurrent-ack');assert.equal(head.base.ackSeq,1);
      const trace=head.control.conflict.recoveryTrace;
      assert.ok(trace.some(row=>row.reason==='immediate_retry_exhausted'));
      if(fault==='draft')assert.equal(trace.at(-1).reason,'replay_mismatch');
      if(fault==='storage')assert.equal(trace.at(-1).reason,'storage_error');
      assert.ok(trace.every(row=>Object.keys(row).sort().join(',')==='attempt,reason'));
    }
    await f.api.quiesceForStorageCutover();assert.equal(f.api.runtime.isPending(),false);
  }finally{clearTimeout(wake)}
});

test('orders: another device changing the same field during quiet recovery still requires business conflict review',async()=>{
  let recoveries=0;
  const f=await postAckFixture('orders',{enforceRevision:true,onCommitted:f=>f.edit('original-note','typing-1'),onRecovery:async f=>{
    if(++recoveries<=2)await f.edit('original-note','typing-'+(recoveries+1));
    if(recoveries===2){
      const head=await f.runtime.cloudState(),remote=structuredClone(head.base.state);
      remote.notes[0].content='other-device';f.setRemote({revision:12,state:remote});
    }
  }});
  assert.equal(await f.save(),false);assert.equal(recoveries,3);assert.equal(f.calls.length,2);
  const head=await f.runtime.cloudState();assert.equal(head.control.conflict.kind,'entity-conflict');
  assert.equal(head.base.ackSeq,1);assert.equal(head.base.revision,12);assert.equal(head.pending,true);
  assert.equal(f.model.state.notes[0].content,'typing-3');assert.equal((await f.runtime.recoverReadOnly()).state.notes[0].content,'typing-3');
  assert.equal(head.control.conflict.items[0].remote.content,'other-device');
  await f.api.quiesceForStorageCutover();assert.equal(f.api.runtime.isPending(),false);
});

test('Orders: a replacement scope cannot orphan a previous recovery waiter', {timeout:1500}, async()=>{
  let active='old';
  const save=createMainSaveOperation({session:{localGeneration:0},tab:{primaryTab:true},
    access:{writeScopeCurrent:scope=>scope===active},journal:{},write:{},confirmation:{},view:{}});
  try{
    const previous=save.waitForPostAckQuiet('old');
    active='new';
    const replacement=save.waitForPostAckQuiet('new');
    assert.equal(await previous,false);
    assert.equal(await replacement,true);
  }finally{save.stop()}
});

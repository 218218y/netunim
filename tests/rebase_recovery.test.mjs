import test from 'node:test';
import assert from 'node:assert/strict';
import {postAckFixture} from './post_ack_fixture.mjs';

for(const app of ['orders','kupa'])test(`${app}: journaled edit during rebase converges without overwriting local or remote rows`,async()=>{
  const f=await postAckFixture(app,{enforceRevision:true,composed:true,onRejected:async f=>{await f.edit('during-rebase','new local edit')}});
  const remote=f.project(f.model.state);remote.notes=[{id:'remote-only',content:'other computer',createdAt:'2026-10-11',updatedAt:'2026-10-11'}];
  f.setRemote({revision:11,state:remote});
  assert.equal(await f.save(),true);
  const state=await f.runtime.cloudState();assert.equal(state.control,null);assert.equal(state.pending,false);
  const values=f.model.state.notes.map(row=>row.content).sort();assert.deepEqual(values,['flight-value','new local edit','other computer'].sort());
  assert.deepEqual(f.project((await f.runtime.recover()).state),state.base.state);
  assert.deepEqual(f.project(f.model.state),state.base.state);
  assert.equal(new Set(f.calls.map(call=>call.operationId)).size,f.calls.length);
});

for(const app of ['orders','kupa'])for(const change of ['draft','login','primary'])test(`${app} rebase recovery retains fencing for ${change}`,async()=>{
  const f=await postAckFixture(app,{enforceRevision:true,composed:true,onRejected:async f=>{
    if(change==='draft'){f.model.state.notes.push({id:'draft',content:'not journaled'});f.session.localGeneration++}
    if(change==='login')f.changeLogin();
    if(change==='primary')f.tab.primaryTab=false;
  }});
  const remote=f.project(f.model.state);remote.notes.push({id:'remote-only',content:'remote'});f.setRemote({revision:11,state:remote});
  assert.equal(await f.save(),false);assert.equal(f.calls.length,1);
  if(change==='draft')assert.equal((await f.runtime.cloudState()).control.conflict.kind,'concurrent-rebase');
});

for(const app of ['orders','kupa'])test(`${app} continuous writes exhaust bounded rebase recovery and retain the journal`,async()=>{
  let attempts=0;
  const f=await postAckFixture(app,{enforceRevision:true,composed:true,onRejected:f=>f.edit('during-rebase','retained'),onRecovery:f=>f.edit(`racing-${++attempts}`,'retained')});
  const remote=f.project(f.model.state);remote.notes.push({id:'remote-only',content:'remote'});f.setRemote({revision:11,state:remote});
  assert.equal(await f.save(),false);assert.equal(attempts,2);assert.equal(f.calls.length,1);
  const head=await f.runtime.cloudState();assert.equal(head.control.conflict.kind,'concurrent-rebase');assert.equal(head.base.ackSeq,0);
  for(const id of ['during-rebase','racing-1','racing-2'])assert.ok(f.model.state.notes.some(row=>row.id===id));
});

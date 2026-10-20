import test from 'node:test';
import assert from 'node:assert/strict';
import {postAckFixture} from './post_ack_fixture.mjs';
import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';
import {createStorageJournal} from '../shared/storage-journal.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

for(const app of ['orders','kupa'])test(`${app}: pressure counters distinguish pending IDB commits from undurable emergency overflow`,async()=>{
  const f=await postAckFixture(app),original=f.wrapped.append;
  let release;const gate=new Promise(resolve=>{release=resolve});
  f.wrapped.append=async(...args)=>{await gate;return original(...args)};
  const writes=[];
  for(let i=0;i<100;i++){
    const record={id:`pressure-${i}`,content:'accepted',createdAt:'2026-10-20',updatedAt:'2026-10-20'};
    f.model.state.notes.push(record);const generation=++f.session.localGeneration;
    const receipt=f.runtime.persist(f.model.state,{generation,operations:[{type:'put',collection:'notes',id:record.id,record,mode:'insert',index:i+1}]});
    writes.push(receipt.committed);
  }
  assert.equal(f.runtime.diagnostics.pendingCommits,100);assert.equal(f.runtime.diagnostics.peakPendingCommits,100);
  assert.ok(f.runtime.diagnostics.undurableCommits>0);assert.equal(f.runtime.durabilityAtRisk,true);
  release();await Promise.all(writes);await f.runtime.commitPromise;
  assert.equal(f.runtime.diagnostics.pendingCommits,0);assert.equal(f.runtime.diagnostics.undurableCommits,0);assert.equal(f.runtime.durabilityAtRisk,false);
  assert.ok(f.runtime.diagnostics.maxCommitLatencyMs>=0);assert.equal((await f.runtime.recoverReadOnly()).state.notes.length,101);
});

test('failed IDB without an emergency copy clears pending counters but keeps the durable-loss alarm',async()=>{
  const db=memoryDb(),failure=Error('QuotaExceededError');
  const runtime=createStorageV2Runtime({app:'orders',owner:()=> 'pressure',primary:()=>true,mode:()=> 'primary',validate:()=>{},scheduleIdle:()=>{},
    createJournal:args=>createStorageJournal({...args,db:{...db,append:async()=>{throw failure}},emergency:emergencyStore({failWrites:true})})});
  await runtime.initializeCloudHead(1,{notes:[]},{sourceOwner:'pressure',intent:'cloud-authoritative',cloudState:{notes:[]}});
  const record={id:'N',content:'uncommitted'},receipt=runtime.persist({notes:[record]},{generation:1,operations:[{type:'put',collection:'notes',id:'N',record,mode:'insert',index:0}]});
  assert.equal(receipt.emergencyDurable,false);await assert.rejects(receipt.committed,error=>error===failure);
  await assert.rejects(runtime.commitPromise,error=>error===failure);
  assert.equal(runtime.diagnostics.pendingCommits,0);assert.equal(runtime.diagnostics.undurableCommits,0);
  assert.equal(runtime.durabilityAtRisk,true);assert.equal(runtime.diagnostics.commitFailures,1);
  assert.equal((await runtime.incidentSample()).durabilityError,true);
});

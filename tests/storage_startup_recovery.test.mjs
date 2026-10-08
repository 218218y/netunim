import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageStartupRecovery} from '../shared/storage-startup-recovery.js';

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
function bound(overrides={},options={}){
  const recovery=createStorageStartupRecovery(options);
  recovery.bind({main:{primary:async()=>true,readOnly:async()=>true},shared:{primary:async()=>true,readOnly:async()=>true},...overrides});
  return recovery;
}

test('recovery requires a complete one-time binding before startup can run',()=>{
  const recovery=createStorageStartupRecovery();
  assert.equal(recovery.isReady(),false);
  assert.throws(()=>recovery.assertBound(),/unbound/);
  assert.throws(()=>recovery.primary({localEngineActive:true}),/unbound/);
  assert.throws(()=>recovery.bind({main:{primary:async()=>true,readOnly:async()=>true},shared:{primary:async()=>true}}),/shared_readOnly_required/);
  recovery.bind({main:{primary:async()=>true,readOnly:async()=>true},shared:{primary:async()=>true,readOnly:async()=>true}});
  recovery.assertBound();assert.throws(()=>recovery.bind({}),/already_bound/);
  assert.throws(()=>recovery.activate(),/not_recovered/);
  assert.throws(()=>createStorageStartupRecovery({wait:null}),/wait_required/);
});

test('primary recovery joins callers, recovers Main then Shared, and awaits explicit activation',async()=>{
  const calls=[],gate=deferred(),main={state:{pending:['durable-change']}};
  const recovery=bound({main:{primary:async context=>{assert.deepEqual(context,{localEngineActive:true});calls.push('main');await gate.promise;return main},readOnly:async()=>true},
    shared:{primary:async()=>{calls.push('shared');return true},readOnly:async()=>true}});
  const task=recovery.primary({localEngineActive:true});assert.equal(recovery.primary({localEngineActive:true}),task);
  await Promise.resolve();assert.deepEqual(calls,['main']);assert.equal(recovery.isReady(),false);
  assert.throws(()=>recovery.activate(),/not_recovered/);
  assert.throws(()=>recovery.readOnly(),/mode_changed/);
  gate.resolve();assert.deepEqual(await task,{main,shared:true});
  assert.equal(recovery.snapshot().phase,'recovered');assert.equal(recovery.isReady(),false);
  assert.equal(recovery.activate(),true);assert.equal(recovery.activate(),false);assert.equal(recovery.isReady(),true);
  await recovery.primary({localEngineActive:true});assert.deepEqual(calls,['main','shared']);
  assert.ok(Object.isFrozen(recovery.snapshot()));
});

for(const journal of ['main','shared'])for(const missing of [false,true]){
  test(`primary ${journal} ${missing?'missing checkpoint':'exception'} preserves failure and never retries`,async()=>{
    let calls=0,sharedCalls=0;const error=new Error('journal_corrupt');
    const fail=async()=>{calls++;if(missing)return false;throw error};
    const recovery=bound({[journal]:{primary:fail,readOnly:async()=>true},
      ...(journal==='main'?{shared:{primary:async()=>{sharedCalls++;return true},readOnly:async()=>true}}:{})});
    const task=recovery.primary({localEngineActive:false});
    await assert.rejects(task,missing?new RegExp(`startup_${journal}_recovery_required`):candidate=>candidate===error);
    assert.equal(recovery.primary({localEngineActive:false}),task);await assert.rejects(task);
    assert.equal(calls,1);assert.equal(sharedCalls,0);assert.equal(recovery.isReady(),false);
    assert.equal(recovery.snapshot().failedAt,journal);assert.equal(recovery.snapshot().phase,'failed');
    assert.throws(()=>recovery.activate(),/not_recovered/);
  });
}

test('secondary reads may retry a checkpoint that is not yet available without invoking writers',async()=>{
  const calls=[],waits=[];let mainReads=0,sharedReads=0;
  const recovery=bound({main:{primary:async()=>assert.fail('secondary writer'),readOnly:async()=>{calls.push('main');return ++mainReads===2}},
    shared:{primary:async()=>assert.fail('secondary Shared writer'),readOnly:async()=>{calls.push('shared');if(++sharedReads===1)throw new Error('primary_commit_pending');return true}}},
    {wait:async delay=>waits.push(delay)});
  const task=recovery.readOnly();assert.equal(recovery.readOnly(),task);
  assert.deepEqual(await task,{main:true,shared:true});assert.deepEqual(calls,['main','main','shared','shared']);
  assert.deepEqual(waits,[60,60]);assert.equal(recovery.isReady(),false);recovery.activate();
  assert.equal(recovery.snapshot().mode,'read-only');assert.equal(recovery.snapshot().error,null);
  assert.throws(()=>recovery.primary({localEngineActive:false}),/mode_changed/);
});

for(const journal of ['main','shared'])test(`secondary ${journal} unavailability is bounded and never displays partial state`,async()=>{
  let reads=0,waits=0,sharedCalls=0;
  const recovery=bound({[journal]:{primary:async()=>assert.fail('secondary writer'),readOnly:async()=>{reads++;return false}},
    ...(journal==='main'?{shared:{primary:async()=>true,readOnly:async()=>{sharedCalls++;return true}}}:{})},
    {wait:async()=>{waits++}});
  assert.equal(await recovery.readOnly(),false);assert.equal(reads,6);assert.equal(waits,5);assert.equal(sharedCalls,0);
  assert.equal(recovery.snapshot().phase,'unavailable');assert.equal(recovery.isReady(),false);
  assert.throws(()=>recovery.activate(),/not_recovered/);
  await recovery.readOnly();assert.equal(reads,6);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';
import {createCloudRecoveryRuntime} from '../shared/cloud-recovery-runtime.js';

const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const tick=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};

test('task ownership preserves synchronous submission and the original result',async()=>{
  const owner=createRuntimeTaskOwner(),held=gate();let submitted=false;
  const result=owner.run(()=>{submitted=true;return held.promise});
  assert.equal(submitted,true);assert.equal(owner.isPending(),true);
  let drained=false;const drain=owner.drain().then(()=>{drained=true});await tick();assert.equal(drained,false);
  held.resolve('original receipt');assert.equal(await result,'original receipt');await drain;assert.equal(owner.isPending(),false);
});

test('drain includes work accepted by the continuation of an earlier task',async()=>{
  const owner=createRuntimeTaskOwner(),first=gate(),second=gate();
  const parent=owner.run(async()=>{await first.promise;void owner.run(()=>second.promise);return true});
  let drained=false;const drain=owner.drain().then(()=>{drained=true});first.resolve();await parent;await tick();assert.equal(drained,false);
  second.resolve();await drain;assert.equal(owner.isPending(),false);
});

test('closing rejects new tasks while accepted failure remains observable and drainable',async()=>{
  const owner=createRuntimeTaskOwner(),held=gate(),failure=new Error('accepted failure');
  const accepted=owner.run(async()=>{await held.promise;throw failure});
  assert.equal(owner.close(),true);assert.equal(owner.close(),false);assert.throws(()=>owner.run(()=>{}),/owner_closed/);
  const rejected=assert.rejects(accepted,error=>error===failure);held.resolve();await rejected;await owner.drain();
  assert.equal(owner.isPending(),false);
});

test('synchronous failures stay rejected task results and do not poison later work',async()=>{
  const owner=createRuntimeTaskOwner(),failure=new Error('synchronous failure');
  await assert.rejects(owner.run(()=>{throw failure}),error=>error===failure);
  assert.equal(await owner.run(()=>42),42);await owner.drain();assert.equal(owner.isPending(),false);
});

function recoveryFixture(){
  let next=0,eligible=true,calls=0;const jobs=new Map(),errors=[],held=gate();
  const owner=createCloudRecoveryRuntime({isEligible:()=>eligible,run:()=>{calls++;return held.promise},onError:error=>errors.push(error),
    timers:{setTimeout(run,delay){const id=++next;jobs.set(id,{run,delay});return id},clearTimeout:id=>jobs.delete(id)}});
  const fire=()=>{const [id,job]=jobs.entries().next().value;jobs.delete(id);job.run()};
  return {owner,jobs,errors,held,fire,calls:()=>calls,eligible:value=>{eligible=value}};
}

test('cloud recovery preserves capped backoff, de-duplicates wakeups and resets after success',async()=>{
  const f=recoveryFixture();
  for(const delay of [15_000,30_000,60_000,120_000,120_000]){
    assert.equal(f.owner.schedule(),true);assert.equal(f.owner.schedule(),false);
    assert.equal([...f.jobs.values()][0].delay,delay);f.fire();
  }
  f.owner.reset();assert.equal(f.owner.schedule(),true);assert.equal([...f.jobs.values()][0].delay,15_000);
  f.owner.cancel();f.held.resolve();await f.owner.drain();assert.deepEqual(f.errors,[]);
});

for(const stop of ['cancel','dispose'])test(`recovery ${stop} fences an already delivered stale callback and drains accepted work`,async()=>{
  const f=recoveryFixture();f.owner.schedule();const stale=[...f.jobs.values()][0].run;
  f.owner[stop]();stale();assert.equal(f.calls(),0);assert.equal(f.jobs.size,0);
  if(stop==='dispose'){assert.equal(f.owner.schedule(),false);return}
  f.owner.schedule();f.fire();assert.equal(f.calls(),1);f.owner.cancel();
  let drained=false;const drain=f.owner.drain().then(()=>{drained=true});await tick();assert.equal(drained,false);
  f.held.resolve();await drain;assert.equal(f.owner.isPending(),false);
});

test('a recovery wakeup rechecks connectivity/authorization before entry',()=>{
  const f=recoveryFixture();f.owner.schedule();f.eligible(false);f.fire();
  assert.equal(f.calls(),0);assert.equal(f.owner.isPending(),false);assert.equal(f.owner.schedule(),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createPollingTask} from '../shared/runtime-polling.js';

async function settle(){for(let turn=0;turn<10;turn++)await Promise.resolve()}
function clock(){
  let next=0;const jobs=new Map();
  return {jobs,setTimeout:(run,delay)=>{const id=++next;jobs.set(id,{run,delay});return id},clearTimeout:id=>jobs.delete(id),
    fire:()=>{const [id,job]=jobs.entries().next().value;jobs.delete(id);return job.run()}};
}

test('recurring owner preserves the chosen delay and reports synchronous and asynchronous failures',async()=>{
  const timers=clock(),errors=[],failure=new Error('synchronous'),rejection=new Error('asynchronous');let calls=0;
  const task=createPollingTask({timers,delay:()=>13_000,onError:error=>errors.push(error),run:()=>{calls++;if(calls===1)throw failure;if(calls===2)return Promise.reject(rejection)}});
  assert.equal(task.start(),true);assert.equal(task.start(),false);
  assert.equal([...timers.jobs.values()][0].delay,13_000);
  assert.equal(timers.fire(),undefined);await settle();
  assert.deepEqual(errors,[failure]);assert.equal(timers.jobs.size,1);
  timers.fire();await settle();assert.deepEqual(errors,[failure,rejection]);assert.equal(timers.jobs.size,1);
  task.stop();assert.equal(timers.jobs.size,0);
});

test('stop between timer delivery and task entry prevents the old operation',async()=>{
  const timers=clock();let calls=0;
  const task=createPollingTask({timers,delay:()=>100,onError:assert.fail,run:()=>{calls++}});
  task.start();timers.fire();task.stop();task.start();await settle();
  assert.equal(calls,0);assert.equal(timers.jobs.size,1);
  timers.fire();await settle();assert.equal(calls,1);assert.equal(timers.jobs.size,1);task.stop();
});

test('blocking the live scheduling gate cancels the owner until explicitly restarted',async()=>{
  const timers=clock();let allowed=false,calls=0;
  const task=createPollingTask({timers,delay:()=>100,onError:assert.fail,canRun:()=>allowed,run:()=>{calls++}});
  assert.equal(task.start(),false);assert.equal(timers.jobs.size,0);
  allowed=true;assert.equal(task.start(),true);allowed=false;timers.fire();await settle();
  assert.equal(calls,0);assert.equal(timers.jobs.size,0);assert.equal(task.stop(),false);
  allowed=true;assert.equal(task.start(),true);allowed=false;
  assert.equal(task.start(),false);assert.equal(timers.jobs.size,0);
});

test('immediate wakeups join a held operation and preserve one future deadline',async()=>{
  const timers=clock();let release,calls=0;const held=new Promise(resolve=>{release=resolve});
  const task=createPollingTask({timers,delay:()=>900,onError:assert.fail,run:async()=>{calls++;await held;return 'done'}});
  task.start();assert.equal(timers.jobs.size,1);
  const one=task.wake(),two=task.wake();assert.equal(one,two);assert.equal(timers.jobs.size,0);await settle();assert.equal(calls,1);
  task.start();assert.equal(timers.jobs.size,0);release();assert.equal(await one,'done');assert.equal(timers.jobs.size,1);task.stop();
});

test('stop invalidates the in-flight receipt and drains it before a restarted deadline',async()=>{
  const timers=clock();let release,receipt;const held=new Promise(resolve=>{release=resolve});
  const task=createPollingTask({timers,delay:()=>900,onError:assert.fail,run:async current=>{receipt=current;await held}});
  const pending=task.wake();await settle();assert.equal(receipt.isCurrent(),true);task.stop();assert.equal(receipt.isCurrent(),false);
  task.start();assert.equal(timers.jobs.size,0);release();await pending;assert.equal(timers.jobs.size,1);task.stop();
});

test('failure of the live scheduling gate is reported and stops background work',async()=>{
  const timers=clock(),failure=new Error('preferences unavailable'),errors=[];let broken=false,calls=0;
  const task=createPollingTask({timers,delay:()=>100,onError:error=>errors.push(error),canRun:()=>{if(broken)throw failure;return true},run:()=>{calls++}});
  task.start();broken=true;assert.doesNotThrow(()=>timers.fire());await settle();assert.deepEqual(errors,[failure]);assert.equal(calls,0);assert.equal(timers.jobs.size,0);
  broken=false;assert.equal(task.start(),true);task.stop();
});

test('delay failure after a completed operation is observed without an orphan timer',async()=>{
  const timers=clock(),failure=new Error('clock unavailable'),errors=[];let broken=false,calls=0;
  const task=createPollingTask({timers,delay:()=>{if(broken)throw failure;return 100},onError:error=>errors.push(error),run:()=>{calls++;broken=true}});
  task.start();timers.fire();await settle();assert.deepEqual(errors,[failure]);assert.equal(calls,1);assert.equal(timers.jobs.size,0);assert.equal(task.stop(),false);
});

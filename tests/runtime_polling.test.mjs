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

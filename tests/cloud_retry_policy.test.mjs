import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudRetryControl,createOutboxRetryScheduler} from '../shared/cloud-sync.js';

test('transient failures without Retry-After receive bounded exponential durable deadlines',()=>{
  const now=()=>Date.parse('2026-10-20T12:00:00Z');let previous=null;
  for(let attempt=1;attempt<=30;attempt++){
    const retry=createCloudRetryControl({status:503},previous,{now,random:()=>1});
    const delay=Date.parse(retry.nextAttemptAt)-now();
    assert.equal(retry.attempts,attempt);assert.equal(delay,Math.min(60000,2000*2**(attempt-1)));
    previous=JSON.parse(JSON.stringify(retry));
  }
  for(const error of [new TypeError('Failed to fetch'),{status:500},{status:429},{code:'SUPABASE_NETWORK_TIMEOUT'}])
    assert.ok(createCloudRetryControl(error,null,{now,random:()=>0}).nextAttemptAt);
});

test('server Retry-After is honored while authentication, true conflicts and fatal errors never schedule automatic retries',()=>{
  const now=()=>Date.parse('2026-10-20T12:00:00Z');
  const retry=createCloudRetryControl({status:429,retryAfterMs:120000},null,{now});
  assert.equal(Date.parse(retry.nextAttemptAt)-now(),120000);
  for(const error of [{status:401},{status:403},{status:409},{code:'PT409'},{status:400},Error('bad schema')])
    assert.equal(createCloudRetryControl(error,null,{now}).nextAttemptAt,null);
});

test('a persisted fallback deadline schedules exactly one resumed attempt after restart',()=>{
  let time=0,callback,calls=0;const timers=[];
  const retry=JSON.parse(JSON.stringify(createCloudRetryControl({status:503},null,{now:()=>time,random:()=>0})));
  const scheduler=createOutboxRetryScheduler({now:()=>time,setTimer:(fn,delay)=>{callback=fn;timers.push(delay);return timers.length},clearTimer:()=>{}});
  const record={domain:'orders',operationId:'same-flight',generation:1,retry};
  assert.equal(scheduler.schedule(record,()=>calls++),1500);
  assert.equal(scheduler.schedule(record,()=>calls++),1500);assert.equal(timers.length,1);
  time=1499;callback();assert.equal(calls,0);time=1500;callback();assert.equal(calls,1);assert.equal(scheduler.stats().scheduled,false);
});

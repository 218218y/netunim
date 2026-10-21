import test from 'node:test';
import assert from 'node:assert/strict';
import {createKupaConnectivityRuntime} from '../netunim-kupa/site/assets/js/connectivity.js';
import {createOrdersConnectivityRuntime} from '../netunim-orders/site/assets/js/connectivity.js';
import {createOrdersFinanceAutomation} from '../netunim-orders/site/assets/js/domains/finance/automation.js';

function environment(){
  const listeners=new Map(),jobs=new Map();let next=0;
  const target={
    addEventListener(name,fn){const entries=listeners.get(name)||[];entries.push(fn);listeners.set(name,entries)},
    removeEventListener(name,fn){listeners.set(name,(listeners.get(name)||[]).filter(value=>value!==fn))},
  };
  return {
    environment:{window:{...target},document:{...target,hidden:false},navigator:{onLine:true}},
    timers:{setTimeout(fn,ms){const id=++next;jobs.set(id,{fn,ms});return id},clearTimeout(id){jobs.delete(id)}},
    jobs,
    async flush(){
      for(let i=0;i<20;i++){
        const entry=[...jobs.entries()].find(([,job])=>job.ms===0);
        if(!entry)break;
        jobs.delete(entry[0]);entry[1].fn();
        await Promise.resolve();await Promise.resolve();
      }
    },
    async signal(name){for(const fn of listeners.get(name)||[])fn();await Promise.resolve()},
  };
}

test('Kupa initial online browser arms bank after hydration without requiring an online or visibility event',async()=>{
  const f=environment(),calls=[];
  let ready=false;
  const runtime=createKupaConnectivityRuntime({
    access:{primary:()=>true,blocked:()=>!ready},
    cloud:{connected:()=>ready,resumeAfterReconnect:async()=>{},cloudPoll:async()=>{}},
    bank:{startAutoSync:()=>calls.push('bank'),stopAutoSync:()=>calls.push('bank-stop')},
    credit:{startAutoSync:()=>calls.push('credit'),stopAutoSync:()=>calls.push('credit-stop')},
    status:{setSaveStatus:()=>{},setCloudHeaderStatus:()=>{}},
    environment:f.environment,timers:f.timers,
  });
  runtime.start();
  assert.equal(runtime.resumeStartup(),false);
  await f.flush();assert.deepEqual(calls,[]);
  ready=true;
  assert.equal(runtime.resumeStartup(),true);
  await f.flush();assert.deepEqual(calls,['bank','credit']);
  runtime.dispose();assert.equal(f.jobs.size,0);
});

test('Orders startup recovery arms finance after hydration without waiting for a browser event',async()=>{
  const f=environment(),calls=[];
  let ready=false;
  const runtime=createOrdersConnectivityRuntime({
    access:{primary:()=>true,blocked:()=>!ready,authenticated:()=>ready},
    cloud:{enabled:()=>ready,resumeAfterReconnect:async()=>{}},
    checks:{pollSharedChecks:async()=>{}},
    finance:{startAutoSync:()=>calls.push('start'),resumeAutoSync:()=>calls.push('resume'),stopAutoSync:()=>calls.push('stop')},
    morning:{recoverPendingMorningOperation:async()=>{}},
    status:{startupDomainLocked:()=>!ready,setCloud:()=>{}},
    environment:f.environment,timers:f.timers,
  });
  runtime.start();
  runtime.resumeStartup();await f.flush();assert.deepEqual(calls,[]);
  ready=true;
  runtime.resumeStartup();await f.flush();assert.deepEqual(calls,['resume']);
  runtime.dispose();assert.equal(f.jobs.size,0);
});

test('Orders startup recovery preserves the epoch and pending automatic bank timer',async()=>{
  const f=environment(),calls=[];
  const scheduler=createOrdersFinanceAutomation({
    access:{primary:()=>true,authenticated:()=>true,online:()=>true,busy:()=>false,capture:()=>()=>{}},
    preferences:{getBridgeToken:()=> 'paired',bankAutoEnabled:()=>true,creditAutoEnabled:()=>true,creditAutoMode:()=> 'smart',bankAttemptDelayMs:()=>0,creditAttemptDelayMs:()=>0},
    readLastSyncAt:()=>null,
    commands:{bank:async()=>calls.push('bank'),credit:async()=>calls.push('credit')},
    timers:f.timers,
  });
  scheduler.startAutoSync();
  const epoch=scheduler.currentEpoch(),jobs=[...f.jobs.keys()];
  scheduler.resumeAutoSync();
  assert.equal(scheduler.currentEpoch(),epoch);
  assert.deepEqual([...f.jobs.keys()],jobs);
  scheduler.stopAutoSync();assert.equal(f.jobs.size,0);
});

test('Orders startup recovery re-arms only missing finance wakeups without invalidating another owner',()=>{
  const f=environment();let ready=false;
  const scheduler=createOrdersFinanceAutomation({
    access:{primary:()=>true,authenticated:()=>ready,online:()=>true,busy:()=>false,capture:()=>()=>{}},
    preferences:{getBridgeToken:()=> 'paired',bankAutoEnabled:()=>true,creditAutoEnabled:()=>true,creditAutoMode:()=> 'smart'},
    readLastSyncAt:()=>null,
    commands:{bank:async()=>true,credit:async()=>true},timers:f.timers,
  });
  scheduler.startAutoSync();assert.equal(f.jobs.size,0);
  const epoch=scheduler.currentEpoch();
  ready=true;scheduler.resumeAutoSync();
  assert.equal(scheduler.currentEpoch(),epoch);assert.equal(f.jobs.size,2);
  scheduler.stopAutoSync();assert.equal(f.jobs.size,0);
});

test('Kupa successful new pairing re-arms a stopped bank scheduler without navigation',async()=>{
  const {createKupaBankControllerFixture}=await import('./kupa_bank_controller_fixture.mjs');
  const f=environment(),bankJobs=f.jobs;
  let token='';
  const controller=createKupaBankControllerFixture({
    model:{state:{bank:{bankSyncAt:'2020-01-01T00:00:00Z'},checks:[]}},
    session:{backendReady:true,connectionMode:'supabase'},
    operationScope:{capture:()=>()=>{},captureRead:()=>()=>{}},
    autoScope:()=> 'account:test',
    bridge:{getBridgeToken:()=>token,setBridgeToken:value=>{token=value},autoEnabled:()=>true,
      autoAttemptDelayMs:()=>0,markAutoAttempt:()=>{},status:async()=>({bridgeVersion:74,configured:true})},
    saveState:async()=>true,sharedChecksObservedSequence:()=>0,
    render:()=>{},toast:()=>{},effects:{saveJson:()=>{}},timers:f.timers,
  });
  controller.startAutoSync();assert.equal(bankJobs.size,0);
  assert.equal(await controller.saveBankBridgeToken('paired'),true);
  assert.equal(bankJobs.size,1);
  assert.equal([...bankJobs.values()][0].ms,300);
  controller.stopAutoSync();
  assert.equal(bankJobs.size,0);
  controller.runtime.dispose();
});

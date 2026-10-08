import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeResources} from '../shared/runtime-resources.js';
import {createKupaConnectivityRuntime} from '../netunim-kupa/site/assets/js/connectivity.js';
import {createOrdersConnectivityRuntime} from '../netunim-orders/site/assets/js/connectivity.js';

function clock(){
  let next=0;
  const jobs=new Map();
  return {jobs,setTimeout:(run,delay)=>{const id=++next;jobs.set(id,{run,delay});return id},clearTimeout:id=>jobs.delete(id),
    fire:()=>{const pending=[...jobs.values()];jobs.clear();for(const job of pending)job.run()}};
}
async function settle(){for(let turn=0;turn<8;turn++)await Promise.resolve()}
function browser(){return {window:new EventTarget(),document:Object.assign(new EventTarget(),{hidden:false}),navigator:{onLine:true}}}
function emit(target,event){target.dispatchEvent(new Event(event))}

test('resource owner joins scheduled and running tasks by key until completion',async()=>{
  const timers=clock(),resources=createRuntimeResources({timers});
  let calls=0,complete;
  const gate=new Promise(resolve=>{complete=resolve});
  assert.equal(resources.schedule('sync',100,async()=>{calls++;await gate}),true);
  assert.equal(resources.schedule('sync',100,()=>assert.fail('duplicate timer')),false);
  assert.equal(timers.jobs.size,1);
  timers.fire();await settle();
  assert.equal(calls,1);
  assert.equal(resources.schedule('sync',100,()=>assert.fail('duplicate request')),false);
  assert.equal(resources.cancel('sync'),false,'a running durability operation cannot be cancelled');
  complete();await settle();
  assert.equal(resources.schedule('sync',100,()=>{calls++}),true);
  timers.fire();await settle();assert.equal(calls,2);
});

test('resource disposal removes only owned listeners and prevents queued work',async()=>{
  const timers=clock(),target=new EventTarget(),resources=createRuntimeResources({timers});
  let owned=0,unrelated=0,runs=0;
  target.addEventListener('event',()=>{unrelated++});
  resources.listen(target,'event',()=>{owned++});
  emit(target,'event');
  resources.schedule('pending',100,()=>{runs++});
  resources.schedule('queued-microtask',0,()=>{runs++});
  timers.fire();
  assert.equal(resources.dispose(),true);
  assert.equal(resources.dispose(),false);
  await settle();emit(target,'event');
  assert.equal(owned,1);assert.equal(unrelated,2);assert.equal(runs,0);
  assert.equal(timers.jobs.size,0);
  assert.equal(resources.schedule('disposed',0,()=>{runs++}),false);
  assert.throws(()=>resources.listen(target,'event',()=>{}),/resources_disposed/);
});

test('wakeup failures retain their task identity and do not schedule retries',async()=>{
  const timers=clock(),errors=[],resources=createRuntimeResources({timers,onError:(error,key)=>errors.push({error,key})});
  const sync=new Error('sync_failed'),asyncError=new Error('async_failed');
  resources.schedule('sync',0,()=>{throw sync});
  resources.schedule('async',0,async()=>{throw asyncError});
  timers.fire();await settle();
  assert.deepEqual(errors,[{error:sync,key:'sync'},{error:asyncError,key:'async'}]);
  assert.equal(timers.jobs.size,0);
});

function kupa(){
  const timers=clock(),environment=browser(),events=[],tab={primaryTab:true},session={storageProtocolBlocked:false,connectionMode:'supabase'};
  const runtime=createKupaConnectivityRuntime({tab,session,timers,environment,
    syncDocument:{resumeAfterReconnect:async()=>events.push('reconnect'),cloudPoll:async()=>events.push('poll')},
    bank:{maybeAutoRefreshBankBalance:()=>events.push('bank')},credit:{maybeAutoRefreshCreditSync:async()=>events.push('credit')},
    status:{setSaveStatus:()=>events.push('offline-save'),setCloudHeaderStatus:()=>events.push('offline-cloud')}});
  return {timers,environment,events,tab,session,runtime};
}

test('Kupa connectivity starts once and coalesces repeated reconnect and finance wakeups',async()=>{
  const f=kupa();assert.equal(f.runtime.start(),true);assert.equal(f.runtime.start(),false);
  emit(f.environment.window,'online');emit(f.environment.window,'online');
  assert.equal(f.timers.jobs.size,2);
  f.timers.fire();await settle();
  assert.deepEqual(f.events,['reconnect','bank','credit']);
  f.runtime.dispose();
});

test('Kupa delayed wakeups recheck leadership, protocol, connectivity and cloud mode',async()=>{
  for(const change of [f=>{f.tab.primaryTab=false},f=>{f.session.storageProtocolBlocked=true},f=>{f.environment.navigator.onLine=false},f=>{f.session.connectionMode='folder'}]){
    const f=kupa();f.runtime.start();emit(f.environment.window,'online');change(f);
    f.timers.fire();await settle();
    assert.equal(f.events.includes('reconnect'),false);
    if(f.session.connectionMode!=='folder')assert.deepEqual(f.events,[]);
    f.runtime.dispose();
  }
});

test('Kupa offline, hidden document and disposal remove pending wakeups',async()=>{
  const f=kupa();f.runtime.start();
  emit(f.environment.document,'visibilitychange');
  f.environment.document.hidden=true;emit(f.environment.document,'visibilitychange');
  assert.equal(f.timers.jobs.size,0);
  emit(f.environment.window,'online');f.environment.navigator.onLine=false;emit(f.environment.window,'offline');
  assert.equal(f.timers.jobs.size,0);
  assert.deepEqual(f.events,['offline-save','offline-cloud']);
  f.environment.navigator.onLine=true;emit(f.environment.window,'online');
  assert.equal(f.runtime.dispose(),true);assert.equal(f.runtime.dispose(),false);
  f.timers.fire();await settle();emit(f.environment.window,'online');
  assert.equal(f.timers.jobs.size,0);
  assert.throws(()=>f.runtime.start(),/connectivity_disposed/);
});

function orders(){
  const timers=clock(),environment=browser(),events=[],state={primary:true,blocked:false,authenticated:true,cloud:true,locks:new Set()};
  const runtime=createOrdersConnectivityRuntime({timers,environment,
    access:{primary:()=>state.primary,blocked:()=>state.blocked,authenticated:()=>state.authenticated},
    cloud:{enabled:()=>state.cloud,resumeAfterReconnect:async()=>events.push('reconnect')},
    checks:{pollSharedChecks:async()=>events.push('checks')},finance:{startAutoSync:()=>events.push('finance')},
    morning:{recoverPendingMorningOperation:async options=>{assert.deepEqual(options,{quiet:true});events.push('morning')}},
    status:{startupDomainLocked:domain=>state.locks.has(domain),setCloud:()=>events.push('offline')}});
  return {timers,environment,events,state,runtime};
}

test('Orders online wakeup preserves Main reconnect, Morning recovery and finance scheduling',async()=>{
  const f=orders();f.runtime.start();
  emit(f.environment.window,'online');emit(f.environment.window,'online');
  assert.deepEqual([...f.timers.jobs.values()].map(job=>job.delay),[250,450,0]);
  f.timers.fire();await settle();
  assert.deepEqual(new Set(f.events),new Set(['reconnect','morning','finance']));
  assert.equal(f.events.length,3);
  f.runtime.dispose();
});

test('Orders connectivity coalesces wakeups and validates the current startup domain gates',async()=>{
  const f=orders();assert.equal(f.runtime.start(),true);assert.equal(f.runtime.start(),false);
  emit(f.environment.document,'visibilitychange');emit(f.environment.document,'visibilitychange');
  assert.equal(f.timers.jobs.size,3);
  f.state.locks.add('checks');f.state.locks.add('finance');f.state.authenticated=false;
  f.timers.fire();await settle();assert.deepEqual(f.events,[]);
  f.runtime.dispose();
});

test('Orders secondary tab may poll Shared but cannot reconnect Main or recover Morning writes',async()=>{
  const f=orders();f.state.primary=false;f.runtime.start();emit(f.environment.window,'online');
  f.timers.fire();await settle();
  assert.deepEqual(f.events,['checks','finance']);
  f.runtime.dispose();
});

test('Orders scheduled Main and Morning wakeups cannot run after leadership or protocol changes',async()=>{
  for(const change of [f=>{f.state.primary=false},f=>{f.state.blocked=true},f=>{f.environment.navigator.onLine=false}]){
    const f=orders();f.runtime.start();emit(f.environment.window,'online');change(f);
    f.timers.fire();await settle();
    assert.equal(f.events.includes('reconnect'),false);assert.equal(f.events.includes('morning'),false);
    f.runtime.dispose();
  }
});

test('Orders offline and disposal cancel pending work without affecting unrelated listeners',async()=>{
  const f=orders();f.runtime.start();emit(f.environment.window,'online');
  f.environment.navigator.onLine=false;emit(f.environment.window,'offline');
  assert.equal(f.timers.jobs.size,0);assert.deepEqual(f.events,['offline']);
  f.environment.navigator.onLine=true;emit(f.environment.window,'online');f.runtime.dispose();
  f.timers.fire();await settle();emit(f.environment.document,'visibilitychange');
  assert.deepEqual(f.events,['offline']);assert.equal(f.timers.jobs.size,0);
  assert.throws(()=>f.runtime.start(),/connectivity_disposed/);
});

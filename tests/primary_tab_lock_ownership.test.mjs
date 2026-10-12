import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrimaryTabLock} from '../shared/tab-lock.js';
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
class StorageMock{
  items=new Map();
  getItem(key){return this.items.get(key)??null}
  setItem(key,value){this.items.set(key,String(value))}
  removeItem(key){this.items.delete(key)}
}
async function environment(run){
  const keys=['navigator','window','localStorage','sessionStorage','BroadcastChannel','setTimeout','clearTimeout','setInterval','clearInterval'];
  const descriptors=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const listeners=new Map(),timeouts=new Map(),intervals=new Map();let next=0;
  const install=(key,value)=>Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const window={addEventListener(type,fn){const set=listeners.get(type)||new Set();set.add(fn);listeners.set(type,set)},removeEventListener(type,fn){listeners.get(type)?.delete(fn)}};
  const local=new StorageMock(),session=new StorageMock();
  install('window',window);install('localStorage',local);install('sessionStorage',session);install('BroadcastChannel',undefined);install('navigator',{});
  install('setTimeout',(run,delay)=>{const id=++next;timeouts.set(id,{run,delay});return id});install('clearTimeout',id=>timeouts.delete(id));
  install('setInterval',(run,delay)=>{const id=++next;intervals.set(id,{run,delay});return id});install('clearInterval',id=>intervals.delete(id));
  const f={install,local,session,listeners,timeouts,intervals,flush:()=>{for(const [id,job] of [...timeouts]){timeouts.delete(id);job.run()}}};
  try{await run(f)}finally{
    for(const fn of listeners.get('pagehide')||[])fn();
    for(const [key,descriptor] of descriptors)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
  }
}
const tab=()=>({primaryTab:true,primaryTabReady:false,readOnlyTab:false});
test('repeated native acquisition joins the held lock rather than demoting its own writer',()=>environment(async f=>{
  let locked=false,requests=0;const entered=gate();
  f.install('navigator',{locks:{request:async(_name,_options,run)=>{
    requests++;if(locked)return run(null);locked=true;entered.resolve();try{return await run({name:'primary'})}finally{locked=false}
  }}});
  const state=tab(),owner=createPrimaryTabLock({lockName:'ownership-test',tab:state,showSecondaryTabGuard:()=>{}});
  assert.equal(await owner.acquirePrimaryTabLock(),true);await entered.promise;
  try{assert.equal(await owner.acquirePrimaryTabLock(),true);assert.equal(state.primaryTab,true);assert.equal(requests,1)}
  finally{if(owner.runtime){owner.runtime.dispose();await owner.runtime.drain()}else state.primaryLockRelease?.()}
}));
test('repeated fallback acquisition registers one heartbeat and one listener set',()=>environment(async f=>{
  const owner=createPrimaryTabLock({lockName:'ownership-test',tab:tab(),showSecondaryTabGuard:()=>{}});
  const first=owner.acquirePrimaryTabLock();f.flush();assert.equal(await first,true);
  const second=owner.acquirePrimaryTabLock();f.flush();await second;
  assert.equal(f.intervals.size,1);assert.equal(f.listeners.get('storage').size,1);assert.equal(f.listeners.get('pagehide').size,1);
}));
test('copied sessionStorage identity cannot admit two fallback writers',()=>environment(async f=>{
  // A newly opened/duplicated tab may inherit its opener's sessionStorage.
  f.session.setItem('netunim:primary:ownership-test:id','inherited-tab-id');
  const a=tab(),b=tab(),first=createPrimaryTabLock({lockName:'ownership-test',tab:a,showSecondaryTabGuard:()=>{}});
  const acquiring=first.acquirePrimaryTabLock();f.flush();assert.equal(await acquiring,true);
  const second=createPrimaryTabLock({lockName:'ownership-test',tab:b,showSecondaryTabGuard:()=>{}});
  const joining=second.acquirePrimaryTabLock();f.flush();
  assert.equal(await joining,false);assert.equal(a.primaryTab,true);assert.equal(b.primaryTab,false);
}));

test('concurrent native acquisition coalesces before the grant arrives',()=>environment(async f=>{
  const grant=gate();let requests=0;
  f.install('navigator',{locks:{request:async(_name,_options,run)=>{requests++;await grant.promise;return run({name:'primary'})}}});
  const state=tab(),owner=createPrimaryTabLock({lockName:'ownership-test',tab:state,showSecondaryTabGuard:()=>{}});
  const first=owner.acquirePrimaryTabLock(),second=owner.acquirePrimaryTabLock();
  assert.equal(first,second);assert.equal(requests,1);grant.resolve();
  assert.deepEqual(await Promise.all([first,second]),[true,true]);owner.runtime.dispose();await owner.runtime.drain();
  assert.equal(state.primaryTab,false);assert.equal(state.readOnlyTab,true);assert.equal(owner.runtime.isPending(),false);
}));

test('disposing before a native grant rejects acquisition and releases the late grant',()=>environment(async f=>{
  const grant=gate();let held=false;
  f.install('navigator',{locks:{request:async(_name,_options,run)=>{await grant.promise;held=true;try{return await run({name:'primary'})}finally{held=false}}}});
  const state=tab(),owner=createPrimaryTabLock({lockName:'ownership-test',tab:state,showSecondaryTabGuard:()=>{}});
  const acquiring=owner.acquirePrimaryTabLock();assert.equal(owner.runtime.dispose(),true);assert.equal(owner.runtime.dispose(),false);
  assert.equal(await acquiring,false);assert.equal(await owner.acquirePrimaryTabLock(),false);
  let drained=false;const draining=owner.runtime.drain().then(()=>{drained=true});await Promise.resolve();assert.equal(drained,false);
  grant.resolve();await draining;assert.equal(held,false);assert.equal(state.primaryTab,false);assert.equal(f.listeners.get('pagehide').size,0);
}));

test('fallback disposal removes owned resources and fences delivered old callbacks',()=>environment(async f=>{
  let closes=0,notifications=0;const channelCallbacks=[];
  f.install('BroadcastChannel',class{
    addEventListener(_event,run){channelCallbacks.push(run)}removeEventListener(){}close(){closes++}postMessage(){notifications++}
  });
  const state=tab(),owner=createPrimaryTabLock({lockName:'ownership-test',tab:state,showSecondaryTabGuard:()=>{}});
  const acquiring=owner.acquirePrimaryTabLock(),oldTimers=[...f.timeouts.values(),...f.intervals.values()],oldStorage=[...f.listeners.get('storage')];
  assert.equal(owner.runtime.dispose(),true);assert.equal(await acquiring,false);await owner.runtime.drain();
  assert.equal(f.timeouts.size,0);assert.equal(f.intervals.size,0);assert.equal(f.listeners.get('storage').size,0);assert.equal(f.listeners.get('pagehide').size,0);assert.equal(closes,1);
  f.local.setItem('netunim:primary:ownership-test',JSON.stringify({id:'independent writer',expiresAt:Date.now()+50_000}));
  const retained=f.local.getItem('netunim:primary:ownership-test'),before=notifications;
  for(const job of oldTimers)job.run();for(const callback of oldStorage)callback({newValue:null});
  for(const callback of channelCallbacks)callback({data:{type:'primary-heartbeat',id:'other'}});
  assert.equal(f.local.getItem('netunim:primary:ownership-test'),retained);assert.equal(notifications,before);assert.equal(state.primaryTab,false);
  assert.equal(await owner.acquirePrimaryTabLock(),false);assert.equal(f.intervals.size,0);
}));

test('fallback cleanup never removes a replacement owner lease',()=>environment(async f=>{
  const owner=createPrimaryTabLock({lockName:'ownership-test',tab:tab(),showSecondaryTabGuard:()=>{}});
  const acquiring=owner.acquirePrimaryTabLock();f.flush();await acquiring;
  const retained=JSON.stringify({id:'replacement',expiresAt:Date.now()+50_000});f.local.setItem('netunim:primary:ownership-test',retained);
  owner.runtime.dispose();await owner.runtime.drain();assert.equal(f.local.getItem('netunim:primary:ownership-test'),retained);
}));

test('pagehide closes native ownership and a stale lifecycle callback cannot regrant',()=>environment(async f=>{
  let held=false;
  f.install('navigator',{locks:{request:async(_name,_options,run)=>{held=true;try{return await run({name:'primary'})}finally{held=false}}}});
  const state=tab(),owner=createPrimaryTabLock({lockName:'ownership-test',tab:state,showSecondaryTabGuard:()=>{}});
  assert.equal(await owner.acquirePrimaryTabLock(),true);const pagehide=[...f.listeners.get('pagehide')][0];pagehide();await owner.runtime.drain();
  pagehide();assert.equal(held,false);assert.equal(await owner.acquirePrimaryTabLock(),false);assert.equal(state.primaryTab,false);
}));

test('an exception from the native request selects one owned fallback and joins it',()=>environment(async f=>{
  f.install('navigator',{locks:{request(){throw new Error('native unavailable')}}});let errors=0;
  const owner=createPrimaryTabLock({lockName:'ownership-test',tab:tab(),showSecondaryTabGuard:()=>{},onError:()=>{errors++}});
  const first=owner.acquirePrimaryTabLock(),second=owner.acquirePrimaryTabLock();assert.equal(first,second);f.flush();
  assert.deepEqual(await Promise.all([first,second]),[true,true]);assert.equal(f.intervals.size,1);assert.equal(errors,1);
  owner.runtime.dispose();await owner.runtime.drain();
}));

test('native denial freezes read-only ownership and does not enter fallback',()=>environment(async f=>{
  let requests=0;f.install('navigator',{locks:{request:async(_name,_options,run)=>{requests++;return run(null)}}});
  const state=tab(),owner=createPrimaryTabLock({lockName:'ownership-test',tab:state,showSecondaryTabGuard:()=>{}});
  assert.equal(await owner.acquirePrimaryTabLock(),false);assert.equal(await owner.acquirePrimaryTabLock(),false);
  assert.equal(state.readOnlyTab,true);assert.equal(requests,1);assert.equal(f.intervals.size,0);owner.runtime.dispose();await owner.runtime.drain();
}));

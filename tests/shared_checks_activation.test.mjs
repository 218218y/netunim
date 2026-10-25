import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedChecksV2Runtime} from '../shared/shared-checks-v2-runtime.js';
import {createSharedChecksStorageV2} from '../shared/shared-checks-storage-v2.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const state=()=>({checks:[{id:'C',amount:100}],bankEvents:[]});
const put={type:'put',collection:'checks',id:'C',mode:'replace'};
function fixture(local=false){
  let owner=local?'local':'A',generation=1,visible=state(),failApply=false,onApply=()=>{};
  const databases=new Map(),stores=[],emergency=emergencyStore();let remoteReads=0,rpcs=0;
  const runtime=createSharedChecksV2Runtime({owner:()=>owner,primary:()=>true,mode:()=> 'primary',
    captureCommitAuthority:()=>{const accepted=generation;return ()=>accepted===generation},
    readState:()=>visible,applyState:value=>{onApply();if(failApply)throw new Error('apply failed');visible=value},
    merge:(_base,local)=>({checks:local,conflicts:[]}),readRemote:async()=>{remoteReads++;return null},rpc:async()=>{rpcs++;return null},
    refreshBankRpc:async()=>assert.fail('unready bank refresh'),
    createStorage:options=>{
      if(!databases.has(owner))databases.set(owner,memoryDb());
      const store=createSharedChecksStorageV2({...options,db:databases.get(owner),emergency});stores.push(store);return store;
    }});
  return {runtime,stores,databases,get visible(){return visible},get networkCalls(){return remoteReads+rpcs},
    set failApply(value){failApply=value},set onApply(value){onApply=value},
    switchOwner(next){owner=next;generation++},
    initialize:()=>local?runtime.initializeLocal({state:visible}):runtime.initialize({state:visible,revision:7,intent:'cloud-authoritative',sourceOwner:owner}),
    edit(){visible.checks[0].amount++;return runtime.persist([put])}};
}
async function assertClosed(f){
  const r=f.runtime;
  assert.equal(r.primaryReady,false);assert.equal(r.localReady,false);assert.equal(r.cloudReady,false);assert.equal(r.hasLocalWork,true);
  assert.throws(()=>f.edit(),/not_recovered/);
  await assert.rejects(r.flush(),/not_recovered/);
  await assert.rejects(async()=>r.sync(),/not_recovered/);
  await assert.rejects(r.refreshBankMatches(),/not_recovered/);
  await assert.rejects(r.replaceAuthoritativeState(state(),{boundaryId:'unready'}),/coordinated_boundary/);
  await assert.rejects(r.resetCloudHead(8,state(),{boundaryId:'unready'}),/coordinated_boundary/);
  assert.equal(f.networkCalls,0);
}

for(const local of [false,true])test(`${local?'local':'cloud'} initialization publishes readiness only after applyState, and retries the durable head`,async()=>{
  const f=fixture(local);f.failApply=true;
  let readiness;
  f.onApply=()=>{readiness=[f.runtime.primaryReady,f.runtime.cloudReady]};
  await assert.rejects(f.initialize(),/apply failed/);
  assert.deepEqual(readiness,[false,false]);
  assert.equal(f.runtime.diagnostics.initializations,0);await assertClosed(f);
  const stored=await f.databases.values().next().value.load(),epoch=stored.metadata.epoch;
  f.failApply=false;f.onApply=()=>{};const recovered=await f.runtime.recover();
  assert.equal(recovered.epoch,epoch);assert.equal(recovered.state.checks[0].amount,100);
  assert.equal(f.runtime.primaryReady,true);assert.equal(f.runtime.cloudReady,!local);
  await f.edit().committed;assert.equal(await f.runtime.flush(),true);
});

for(const failure of ['recover','database','apply','cloud'])test(`failed repeated recovery (${failure}) revokes readiness without replacing durable data`,async()=>{
  const f=fixture();await f.initialize();await f.edit().committed;
  const store=f.stores[0],db=f.databases.get('A'),before=await db.load(),recover=store.recover,load=db.load,cloudState=store.cloudState;
  if(failure==='recover')store.recover=async()=>{throw new Error('publish failed')};
  if(failure==='database')store.recover=async()=>{db.load=async()=>{throw new Error('publish failed')};try{return await recover()}finally{db.load=load}};
  if(failure==='apply')f.failApply=true;
  if(failure==='cloud')store.cloudState=async()=>{throw new Error('publish failed')};
  await assert.rejects(f.runtime.recover(),/publish failed|apply failed/);
  assert.equal(f.runtime.diagnostics.recoveries,0);await assertClosed(f);
  const after=await db.load();assert.deepEqual(after,before,'a failed publication cannot reset epoch, journal, cursor or pending work');
  store.recover=recover;store.cloudState=cloudState;f.failApply=false;
  const result=await f.runtime.recover();assert.equal(result.epoch,before.metadata.epoch);assert.equal(result.seq,1);assert.equal(result.state.checks[0].amount,101);
  assert.equal(f.stores.length,1);assert.equal(f.runtime.diagnostics.recoveries,1);assert.equal(f.runtime.primaryReady,true);
  await f.edit().committed;assert.equal(await f.runtime.flush(),true);
});

test('an in-progress recovery closes admission and flush, and shares its opening promise',async()=>{
  const f=fixture();await f.initialize();const store=f.stores[0],recover=store.recover,entered=gate(),release=gate();
  store.recover=async()=>{entered.resolve();await release.promise;return recover()};
  const recovering=f.runtime.recover();await entered.promise;assert.equal(f.runtime.recover(),recovering);
  await assertClosed(f);release.resolve();await recovering;assert.equal(f.runtime.primaryReady,true);
});

test('flush started before a failed recovery cannot report success afterwards',async()=>{
  const f=fixture();await f.initialize();const store=f.stores[0],entered=gate(),release=gate();
  store.settled=async()=>{entered.resolve();await release.promise};
  const flushing=f.runtime.flush(),rejected=assert.rejects(flushing,/not_recovered/);await entered.promise;
  f.failApply=true;await assert.rejects(f.runtime.recover(),/apply failed/);
  release.resolve();await rejected;
});

for(const local of [false,true])test(`recovery joins ${local?'local':'cloud'} initialization and competing activation cannot overtake it`,async()=>{
  const f=fixture(local),entered=gate(),release=gate();
  const initializing=f.initialize();
  const store=f.stores[0],method=local?'open':'initializeCloudHead',initialize=store[method];
  store[method]=async(...args)=>{entered.resolve();await release.promise;return initialize(...args)};
  await entered.promise;
  const recovering=f.runtime.recover();await assert.rejects(f.initialize(),/activation_in_progress/);
  await assertClosed(f);release.resolve();const result=await initializing;
  assert.deepEqual(await recovering,result);assert.equal(f.runtime.primaryReady,true);assert.equal(f.runtime.diagnostics.initializations,1);
});

for(const roundTrip of [false,true])for(const completion of ['success','failure'])test(`old recovery ${completion} cannot change readiness after ${roundTrip?'A-B-A':'A-B'}`,async()=>{
  const f=fixture();await f.initialize();const store=f.stores[0],entered=gate(),release=gate();
  store.recover=async()=>{entered.resolve();const value=await release.promise;if(completion==='failure')throw new Error('old publish failed');return value};
  const old=f.runtime.recover(),rejected=assert.rejects(old,/owner_handoff|owner_changed|old publish failed/);await entered.promise;
  f.switchOwner('B');await f.initialize();
  if(roundTrip){f.switchOwner('A');await f.runtime.recover()}
  const before={...f.runtime.diagnostics};release.resolve({state:state(),seq:store.seq});await rejected;
  assert.equal(f.runtime.primaryReady,true);assert.equal(f.runtime.cloudReady,true);assert.equal(f.runtime.hasLocalWork,false);
  assert.deepEqual(f.runtime.diagnostics,before);await f.edit().committed;
});

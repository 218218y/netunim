import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedChecksV2Runtime} from '../shared/shared-checks-v2-runtime.js';
import {createSharedChecksStorageV2} from '../shared/shared-checks-storage-v2.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const state=id=>({checks:[{id,amount:10}],bankEvents:[]});
function fixture(){
  let owner='A',visible=state('A'),primary=true;
  const stores=[],databases=new Map();
  const runtime=createSharedChecksV2Runtime({site:'orders',owner:()=>owner,primary:()=>primary,mode:()=> 'primary',
    readState:()=>visible,applyState:value=>{visible=value},merge:()=>assert.fail('unexpected merge'),readRemote:async()=>null,rpc:async()=>null,
    createStorage:options=>{
      if(!databases.has(owner))databases.set(owner,memoryDb());
      const store=createSharedChecksStorageV2({...options,db:databases.get(owner),emergency:emergencyStore()});stores.push(store);return store;
    }});
  return {runtime,stores,databases,get visible(){return visible},set primary(value){primary=value},
    async activate(next){owner=next;const recovered=await runtime.recover();if(!recovered)await runtime.initialize({state:state(next),revision:1,intent:'cloud-authoritative',sourceOwner:next})},
    edit(){visible.checks[0].amount++;return runtime.persist([{type:'put',collection:'checks',id:visible.checks[0].id,mode:'replace'}])},
    set owner(value){owner=value}};
}

for(const roundTrip of [false,true])test(`stale cloud state cannot publish after ${roundTrip?'A-B-A':'A-B'}`,async()=>{
  const f=fixture();await f.activate('A');const store=f.stores[0],entered=gate(),release=gate();
  store.cloudState=async()=>{entered.resolve();return release.promise};
  const reading=f.runtime.cloudState(),rejected=assert.rejects(reading,/owner_handoff|owner_changed/);await entered.promise;
  await f.activate('B');if(roundTrip)await f.activate('A');
  assert.equal(f.runtime.cloudReady,true);assert.equal(f.runtime.hasLocalWork,false);
  release.resolve({base:null,pending:true,flight:null,control:null});await rejected;
  assert.equal(f.runtime.primaryReady,true);assert.equal(f.runtime.cloudReady,true);assert.equal(f.runtime.hasLocalWork,false);
});

test('cloud state refuses a completion from an earlier epoch of the same store',async()=>{
  const f=fixture();await f.activate('A');const store=f.stores[0],cloudState=store.cloudState,release=gate(),entered=gate();
  store.cloudState=async()=>{entered.resolve();return release.promise};
  const reading=f.runtime.cloudState(),rejected=assert.rejects(reading,/owner_changed/);await entered.promise;
  store.cloudState=cloudState;await f.runtime.replaceAuthoritativeState(state('A'),{boundaryId:'new-epoch'});
  release.resolve({base:null,pending:true});await rejected;assert.equal(f.runtime.cloudReady,true);
});

test('flush requires an active primary and retains the same-owner success contract',async()=>{
  const f=fixture();await assert.rejects(f.runtime.flush(),/handoff|not_recovered/);
  await f.activate('A');await f.edit().committed;assert.equal(await f.runtime.flush(),true);
  f.primary=false;await assert.rejects(f.runtime.flush(),/primary_required/);
});

for(const completion of ['success','failure'])test(`an old ${completion} commit and flush cannot affect a new owner`,async()=>{
  const f=fixture();await f.activate('A');const db=f.databases.get('A'),append=db.append,entered=gate(),release=gate();
  db.append=async(...args)=>{entered.resolve();await release.promise;if(completion==='failure')throw new Error('old IDB failure');return append(...args)};
  const write=f.edit(),written=completion==='failure'?assert.rejects(write.committed,/old IDB failure/):write.committed;
  await entered.promise;const flushing=f.runtime.flush(),rejected=assert.rejects(flushing,/owner_handoff|owner_changed|old IDB failure/);
  await f.activate('B');const before={...f.runtime.diagnostics};
  release.resolve();await written;await rejected;
  assert.equal(f.runtime.primaryReady,true);assert.equal(f.runtime.hasLocalWork,false);assert.equal(await f.runtime.flush(),true);
  assert.deepEqual(f.runtime.diagnostics,before,'old completion must not publish diagnostics into the new context');
});

test('flush waits for the canonical journal queue, including a failed earlier write',async()=>{
  const f=fixture();await f.activate('A');const db=f.databases.get('A'),entered=gate(),release=gate();let calls=0;
  db.append=async()=>{if(++calls===1){entered.resolve();await release.promise;throw new Error('first append failed')}return true};
  const first=f.edit(),second=f.edit(),failedFirst=assert.rejects(first.committed),secondDone=second.committed;
  await entered.promise;let done=false;const flushing=f.runtime.flush().finally(()=>{done=true}),rejected=assert.rejects(flushing);
  await Promise.resolve();assert.equal(done,false);release.resolve();await Promise.all([failedFirst,secondDone,rejected]);
  await assert.rejects(f.runtime.flush(),/not_recovered|first append failed|storage_/);
});

test('flush also waits for a queued epoch replacement and refuses its obsolete epoch',async()=>{
  const f=fixture();await f.activate('A');const db=f.databases.get('A'),reset=db.resetState,entered=gate(),release=gate();
  db.resetState=async(...args)=>{entered.resolve();await release.promise;return reset(...args)};
  const replacing=f.runtime.replaceAuthoritativeState(state('A'),{boundaryId:'replacement'});await entered.promise;
  let done=false;const flushing=f.runtime.flush().finally(()=>{done=true}),rejected=assert.rejects(flushing,/owner_changed/);
  await Promise.resolve();assert.equal(done,false);release.resolve();await replacing;await rejected;
});

test('an old read-only recovery cannot replace the primary state of a new owner',async()=>{
  const f=fixture();await f.activate('A');const db=f.databases.get('A'),load=db.load,entered=gate(),release=gate();
  db.load=async(...args)=>{const result=await load(...args);entered.resolve();await release.promise;return result};
  const reading=f.runtime.recoverReadOnly();await entered.promise;await f.activate('B');const before={...f.runtime.diagnostics};
  release.resolve();assert.equal(await reading,null);assert.equal(f.visible.checks[0].id,'B');assert.deepEqual(f.runtime.diagnostics,before);
});

test('cloud state cannot publish after primary authority is lost',async()=>{
  const f=fixture();await f.activate('A');const release=gate();f.stores[0].cloudState=()=>release.promise;
  const reading=f.runtime.cloudState(),rejected=assert.rejects(reading,/primary_required/);f.primary=false;release.resolve({base:null,pending:true});await rejected;
  f.primary=true;assert.equal(f.runtime.cloudReady,true);assert.equal(f.runtime.hasLocalWork,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageV2LocalBirth,storageLocalEngineKey} from '../shared/storage-v2-local-birth.js';
import {storageV2Mode} from '../shared/storage-v2-runtime.js';

const clone=structuredClone;
function fixture(){
  let plan=null,marker=null,mainState=null,sharedState=null,failAfterMain=false,failAfterMarker=false,sourceReads=0,legacyClean=true;
  const cache=new Map(),app='orders',source={mainState:{notes:[{id:'n',content:'local'}]},sharedState:{checks:[{id:'c',amount:5}],bankEvents:[]}};
  const db={
    async readLocalBirth(){return clone(plan)},
    async beginLocalBirth(_scope,next){if(plan)throw Error('duplicate-birth');plan=clone(next);return clone(plan)},
    async advanceLocalBirth(_scope,id,from,to){if(failAfterMain&&from==='prepared'){failAfterMain=false;throw Error('crash-after-main')};if(failAfterMarker&&from==='verified'){failAfterMarker=false;throw Error('crash-after-marker')};if(plan.id!==id||plan.phase!==from)throw Error('phase-mismatch');plan={...plan,phase:to};return clone(plan)},
    async readLocalEngine(){return clone(marker)},
    async markLocalEngine(){if(plan.phase!=='verified'||!mainState||!sharedState)throw Error('heads-not-ready');marker={version:2,kind:'local-engine',scope:'orders:local',app:'orders',owner:'local'};return clone(marker)},
  };
  const main={async initializeLocal(value){if(mainState)assert.deepEqual(mainState,value);mainState=clone(value)},async recover(){return mainState&&{state:clone(mainState)}}};
  const shared={async initializeLocal({state}){if(sharedState)assert.deepEqual(sharedState,state);sharedState=clone(state)},async recover(){return sharedState&&{state:clone(sharedState)}}};
  const storage={getItem:key=>cache.get(key)??null,setItem:(key,value)=>cache.set(key,value),removeItem:key=>cache.delete(key)};
  const make=()=>createStorageV2LocalBirth({app,owner:()=> 'local',primary:()=>true,main,shared,enableShared:()=>{},readSource:async()=>{sourceReads++;return clone(source)},verifyLegacyClean:async()=>legacyClean,db,storage,operationId:()=> 'birth-1'});
  return {make,cache,source,get plan(){return clone(plan)},get marker(){return clone(marker)},get sourceReads(){return sourceReads},set failAfterMain(value){failAfterMain=value},set failAfterMarker(value){failAfterMarker=value},set legacyClean(value){legacyClean=value}};
}

test('local birth freezes one source plan and resumes after a Main commit without rediscovery',async()=>{
  const f=fixture();f.failAfterMain=true;
  const first=f.make();await assert.rejects(first.begin(),/crash-after-main/);
  assert.equal(f.plan.phase,'prepared');assert.equal(f.marker,null);assert.equal(f.sourceReads,1);
  const restarted=f.make();await restarted.hydrate();assert.equal(restarted.preparing,true);
  await restarted.resume();assert.equal(f.plan.phase,'complete');assert.equal(f.sourceReads,1);
  assert.equal(f.cache.get(storageLocalEngineKey('orders')),'2');assert.equal(await restarted.verify(),true);
});

test('local engine cache is repaired only from its durable marker',async()=>{
  const f=fixture(),birth=f.make();await birth.begin();
  assert.equal(storageV2Mode('orders',{getItem:key=>f.cache.get(key)??null},'local'),'primary');
  f.cache.delete(storageLocalEngineKey('orders'));assert.equal(await birth.verify(),true);assert.equal(f.cache.get(storageLocalEngineKey('orders')),'2');
  const orphan=fixture();orphan.cache.set(storageLocalEngineKey('orders'),'2');await assert.rejects(orphan.make().verify(),/storage_local_engine_marker_mismatch/);
});

test('legacy pending blocks birth before marking the engine',async()=>{
  const f=fixture();f.legacyClean=false;
  await assert.rejects(f.make().begin(),/storage_local_birth_legacy_pending/);
  assert.equal(f.plan,null);assert.equal(f.marker,null);
});

test('restart completes a verified local birth after the durable marker committed',async()=>{
  const f=fixture();f.failAfterMarker=true;
  await assert.rejects(f.make().begin(),/crash-after-marker/);
  assert.equal(f.plan.phase,'verified');assert.equal(f.marker.version,2);
  const restarted=f.make();await restarted.hydrate();assert.equal(restarted.preparing,true);
  await restarted.resume();
  assert.equal(f.plan.phase,'complete');assert.equal(restarted.preparing,false);
  assert.equal(f.sourceReads,1);
});

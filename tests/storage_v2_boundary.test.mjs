import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageV2Boundary} from '../shared/storage-v2-boundary.js';

const clone=structuredClone;
function fixture(){
  let record=null,owner='A',failPhase='',applyCount={shared:0,main:0};
  const db={
    async readBoundary(scoped){return scoped===record?.owner?clone(record):null},
    async beginBoundary(_owner,next){if(record&&record.phase!=='complete')throw new Error('pending');record=clone(next)},
    async advanceBoundary(_owner,id,from,to){if(record.id!==id||record.phase!==from)throw new Error('changed');if(failPhase===to){failPhase='';throw new Error('injected phase write failure')}record={...record,phase:to};return clone(record)},
    async completeBoundary(_owner,id){if(record.id!==id||record.phase!=='main-applied')throw new Error('changed');record={version:2,owner,id,kind:record.kind,phase:'complete'}},
  };
  const makeRuntime=side=>{let state={value:'old'},boundaryId=null,seq=0,control=null,revision=1;return {
    async recover(){return {state:clone(state),seq,appMetadata:{boundaryId}}},
    async cloudState(){return {base:{revision},pending:false,flight:null,control}},
    async replaceAuthoritativeState(next,options){state=clone(next);boundaryId=options.boundaryId||options.appMetadata?.boundaryId;applyCount[side]++;return {state}},
    async resetCloudHead(_revision,_cloud,currentOrOptions,options){state=clone(options?currentOrOptions:_cloud);boundaryId=(options||currentOrOptions).boundaryId||(options||currentOrOptions).appMetadata?.boundaryId;applyCount[side]++;return {state}},
    get state(){return state},
    set seq(value){seq=value},
    set control(value){control=value},
    set revision(value){revision=value},
  }};
  const shared=makeRuntime('shared'),main=makeRuntime('main');
  const create=()=>createStorageV2Boundary({owner:()=>owner,primary:()=>true,main,shared,db});
  const action={id:'restore-123',kind:'restore',main:{kind:'replace-authoritative',state:{value:'new-main'}},shared:{kind:'replace-authoritative',state:{value:'new-shared'}}};
  return {create,action,main,shared,applyCount,get record(){return record},set failPhase(value){failPhase=value},set owner(value){owner=value}};
}

test('restore resumes after shared commit without applying Shared Checks twice',async()=>{
  const f=fixture(),coordinator=f.create();f.failPhase='shared-applied';
  await assert.rejects(coordinator.run(f.action),/injected/);
  assert.equal(coordinator.locked,true);
  assert.equal(f.shared.state.value,'new-shared');assert.equal(f.main.state.value,'old');assert.equal(f.record.phase,'prepared');
  const restarted=f.create();assert.equal(await restarted.pending(),true);
  assert.equal((await restarted.resume()).phase,'complete');
  assert.equal(restarted.locked,false);
  assert.deepEqual(f.applyCount,{shared:1,main:1});assert.equal(f.main.state.value,'new-main');
  assert.equal((await restarted.run(f.action)).phase,'complete');assert.deepEqual(f.applyCount,{shared:1,main:1});
});

test('restore resumes after Main commit without resetting its cloud head twice',async()=>{
  const f=fixture(),coordinator=f.create();f.failPhase='main-applied';
  const action={...f.action,main:{kind:'reset-cloud-head',revision:8,state:{value:'main cloud'},cloudState:{value:'main projection'}},shared:{kind:'reset-cloud-head',revision:10,state:{value:'shared cloud'}}};
  await assert.rejects(coordinator.run(action),/injected/);
  assert.equal(f.record.phase,'shared-applied');assert.equal(f.main.state.value,'main cloud');
  const restarted=f.create();await restarted.resume();assert.deepEqual(f.applyCount,{shared:1,main:1});assert.equal(f.record.phase,'complete');
});

test('pending restore rejects another operation and is scoped to its account',async()=>{
  const f=fixture(),coordinator=f.create();f.failPhase='shared-applied';await assert.rejects(coordinator.run(f.action));
  await assert.rejects(coordinator.run({...f.action,id:'another'}),/pending/);
  f.owner='B';const switched=f.create();assert.equal(await switched.pending(),false);
  assert.equal(await switched.resume(),null);assert.equal(f.record.owner,'A');assert.equal(f.main.state.value,'old');
  assert.equal(coordinator.locked,false);
});

test('stale restore source is rejected before any durable intent or journal replacement',async()=>{
  const f=fixture(),coordinator=f.create();f.shared.seq=2;
  await assert.rejects(coordinator.run({...f.action,shared:{...f.action.shared,expectedSeq:1},main:{...f.action.main,expectedSeq:0}}),/source_changed/);
  assert.equal(f.record,null);assert.deepEqual(f.applyCount,{shared:0,main:0});assert.equal(coordinator.locked,false);
});

test('cloud control created during remote restore blocks local reset before intent',async()=>{
  const f=fixture(),coordinator=f.create();f.shared.control={conflict:{kind:'same-check'}};
  await assert.rejects(coordinator.run({...f.action,shared:{...f.action.shared,expectedSeq:0,requireCleanCloud:true},main:{...f.action.main,expectedSeq:0,requireCleanCloud:true}}),/cloud_changed/);
  assert.equal(f.record,null);assert.deepEqual(f.applyCount,{shared:0,main:0});assert.equal(coordinator.locked,false);
});

test('remote head change during restore blocks a stale local reset',async()=>{
  const f=fixture(),coordinator=f.create();f.main.revision=2;
  await assert.rejects(coordinator.run({...f.action,shared:{...f.action.shared,expectedSeq:0,expectedBaseRevision:1,requireCleanCloud:true},main:{...f.action.main,expectedSeq:0,expectedBaseRevision:1,requireCleanCloud:true}}),/cloud_changed/);
  assert.equal(f.record,null);assert.deepEqual(f.applyCount,{shared:0,main:0});
});

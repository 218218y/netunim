import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageV2CutoverCoordinator} from '../shared/storage-v2-cutover-coordinator.js';

function fakeDb(){
  const rows=new Map();return {
    async readCutoverPreparation(scope){return rows.has(scope)?structuredClone(rows.get(scope)):null},
    async beginCutoverPreparation(scope,record){const current=rows.get(scope);if(current)return structuredClone(current);rows.set(scope,structuredClone(record));return structuredClone(record)},
    async advanceCutoverPreparation(scope,id,from,to,patch){const current=rows.get(scope);if(!current)throw Error('missing');if(current.id!==id||current.phase!==from)throw Error('changed');const next={...current,...structuredClone(patch),phase:to};rows.set(scope,next);return structuredClone(next)},
  }
}
function fixture({failBootstrap=false,failAfterMark=false}={}){
  const db=fakeDb(),calls=[];let marker=false,bootstrapFails=failBootstrap,verifyMarkerFails=failAfterMark;
  const bootstrapExecutor={async start(options){calls.push(`bootstrap:${options.token}`);if(bootstrapFails){bootstrapFails=false;throw Error('simulated-bootstrap-crash')}return {phase:'complete',id:'group-1',planHash:'a'.repeat(64)}}};
  const make=()=>createStorageV2CutoverCoordinator({app:'orders',owner:()=> 'A',primary:()=>true,db,bootstrapExecutor,resumePendingBootstrap:async()=>null,operationId:()=> 'cutover-1',now:()=> '2026-09-23T14:00:00.000Z',
    drainLegacy:async()=>{calls.push('drain');return {cleaned:true}},verifyLegacyClean:async()=>{calls.push('legacy-clean');return true},discoverBootstrap:async()=>{calls.push('discover');return {token:'plan'}},verifyHeads:async()=>{calls.push('verify-heads');return {clean:true,mainRevision:5,sharedRevision:7}},markCutover:async()=>{calls.push('mark');marker=true},verifyCutover:async()=>{calls.push('verify-marker');if(verifyMarkerFails){verifyMarkerFails=false;throw Error('simulated-marker-crash')}return marker}});
  return {make,calls};
}

test('cutover preparation freezes durably before drain and resumes bootstrap without repeating settled source',async()=>{
  const f=fixture({failBootstrap:true});let coordinator=f.make();
  await assert.rejects(coordinator.run(),/simulated-bootstrap-crash/);
  assert.equal(coordinator.preparing,true);assert.equal(coordinator.record.phase,'source-settled');
  assert.deepEqual(f.calls,['drain','legacy-clean','discover','bootstrap:plan']);
  coordinator=f.make();await coordinator.hydrate();assert.equal(coordinator.preparing,true);assert.equal(coordinator.record.phase,'source-settled');
  const done=await coordinator.run();assert.equal(done.phase,'complete');
  assert.equal(f.calls.filter(x=>x==='drain').length,1);assert.equal(f.calls.filter(x=>x==='legacy-clean').length,3);
  assert.deepEqual(f.calls.slice(-8),['discover','bootstrap:plan','legacy-clean','verify-heads','legacy-clean','verify-heads','mark','verify-marker']);
});

test('cutover marker crash resumes from verified phase and mark is safe to retry',async()=>{
  const f=fixture({failAfterMark:true});let coordinator=f.make();
  await assert.rejects(coordinator.run(),/simulated-marker-crash/);assert.equal(coordinator.record.phase,'verified');
  coordinator=f.make();await coordinator.hydrate();const done=await coordinator.run();assert.equal(done.phase,'complete');
  assert.equal(f.calls.filter(x=>x==='drain').length,1);assert.equal(f.calls.filter(x=>x==='bootstrap:plan').length,1);assert.equal(f.calls.filter(x=>x==='mark').length,2);
});

test('verified phase is never trusted after a crash: heads are re-read immediately before marking',async()=>{
  const db=fakeDb(),calls=[];let marker=false,headReads=0,allowFinal=false;
  const bootstrapExecutor={async start(){return {phase:'complete',id:'group-verified',planHash:'b'.repeat(64)}}};
  const make=()=>createStorageV2CutoverCoordinator({app:'orders',owner:()=> 'A',primary:()=>true,db,bootstrapExecutor,resumePendingBootstrap:async()=>null,operationId:()=> 'cutover-verified',now:()=> '2026-09-23T14:10:00.000Z',
    freeze:async()=>calls.push('freeze'),drainLegacy:async()=>({}),verifyLegacyClean:async()=>true,discoverBootstrap:async()=>({}),
    verifyHeads:async()=>{headReads++;calls.push(`heads:${headReads}`);if(headReads>=2&&!allowFinal)throw new Error('remote-changed-after-proof');return {clean:true,mainRevision:3,sharedRevision:4}},
    markCutover:async()=>{marker=true;calls.push('mark')},verifyCutover:async()=>marker});
  let coordinator=make();
  await assert.rejects(coordinator.run(),/remote-changed-after-proof/);
  assert.equal(coordinator.record.phase,'verified');assert.equal(marker,false);assert.equal(headReads,2);
  allowFinal=true;coordinator=make();await coordinator.hydrate();
  assert.equal((await coordinator.run()).phase,'complete');assert.equal(marker,true);assert.equal(headReads,3);
  assert.deepEqual(calls.filter(value=>value==='mark'),['mark']);
});


test('cutover preparation is visible read-only to a secondary tab but cannot be resumed there',async()=>{
  const db=fakeDb(),bootstrapExecutor={async start(){return {phase:'complete',id:'g',planHash:'c'.repeat(64)}}};
  const common={app:'orders',owner:()=> 'A',db,bootstrapExecutor,resumePendingBootstrap:async()=>null,operationId:()=> 'cutover-secondary',now:()=> '2026-09-23T15:00:00.000Z',freeze:async()=>{},drainLegacy:async()=>({}),verifyLegacyClean:async()=>true,discoverBootstrap:async()=>({}),verifyHeads:async()=>({clean:true}),markCutover:async()=>{},verifyCutover:async()=>true};
  const primary=createStorageV2CutoverCoordinator({...common,primary:()=>true});
  await primary.begin();
  const secondary=createStorageV2CutoverCoordinator({...common,primary:()=>false});
  const record=await secondary.hydrate();
  assert.equal(record.phase,'freezing-source');assert.equal(secondary.preparing,true);
  await assert.rejects(()=>secondary.run(),/storage_cutover_primary_required/);
});

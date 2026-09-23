import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createStorageV2BootstrapCoordinator} from '../shared/storage-v2-bootstrap.js';
import {createStorageV2ProductionTransition} from '../shared/storage-v2-production-transition.js';

function durableDb(){
  const bootstraps=new Map(),cutovers=new Map();
  return {
    async readBootstrapGroup(scope){return bootstraps.has(scope)?structuredClone(bootstraps.get(scope)):null},
    async beginBootstrapGroup(scope,record){
      const current=bootstraps.get(scope);
      if(current&&current.phase!=='complete'){
        if(current.id===record.id&&current.planHash===record.planHash)return structuredClone(current);
        throw new Error('storage_bootstrap_group_pending');
      }
      bootstraps.set(scope,structuredClone(record));return structuredClone(record);
    },
    async advanceBootstrapGroup(scope,id,from,to,patch){
      const current=bootstraps.get(scope);if(!current)throw new Error('storage_bootstrap_group_missing');
      if(current.id!==id||current.phase!==from)throw new Error('storage_bootstrap_group_changed');
      const next={...current,...structuredClone(patch),phase:to};bootstraps.set(scope,next);return structuredClone(next);
    },
    async readCutoverPreparation(scope){return cutovers.has(scope)?structuredClone(cutovers.get(scope)):null},
    async beginCutoverPreparation(scope,record){const current=cutovers.get(scope);if(current)return structuredClone(current);cutovers.set(scope,structuredClone(record));return structuredClone(record)},
    async advanceCutoverPreparation(scope,id,from,to,patch){
      const current=cutovers.get(scope);if(!current)throw new Error('storage_cutover_preparation_missing');
      if(current.id!==id||current.phase!==from)throw new Error('storage_cutover_preparation_changed');
      const next={...current,...structuredClone(patch),phase:to};cutovers.set(scope,next);return structuredClone(next);
    },
  };
}

function settled(revision,state,seq=1){return {seq,base:{revision,state:structuredClone(state),ackSeq:seq},flight:null,control:null,pending:false}}

test('production first-cloud cutover uses authenticated owner id and uploads a missing Shared document including bank events',async()=>{
  const owner='account-A',db=durableDb(),calls=[];
  const mainSource={orders:[{id:'o1',value:1}]};
  const sharedSource={checks:[{id:'c1',amount:100}],bankEvents:[{id:'e1',type:'deposit'}]};
  let mainRemote=null,sharedRemote=null,mainCloud=null,sharedCloud=null,marker=false;
  const ownerBinding={
    current:()=>owner,
    assertAuthenticatedOwner(value){calls.push(`auth:${value}`);assert.equal(value,owner);return true},
  };
  const bootstrapCoordinator=createStorageV2BootstrapCoordinator({app:'orders',owner:()=>owner,primary:()=>true,db,cryptoImpl:webcrypto,operationId:()=> 'bootstrap-production'});
  const transition=createStorageV2ProductionTransition({
    app:'orders',ownerBinding,primary:()=>true,online:()=>true,authOwner:()=>owner,bootstrapCoordinator,cutoverDb:db,
    readMainState:()=>structuredClone(mainSource),projectMainState:value=>structuredClone(value),emptyMainState:()=>({orders:[]}),mainSourceSeq:()=>7,
    readSharedState:()=>structuredClone(sharedSource),sharedSourceSeq:()=>4,
    readMainRemote:async()=>mainRemote&&structuredClone(mainRemote),projectMainRemote:row=>structuredClone(row.state),
    readSharedRemote:async()=>sharedRemote&&structuredClone(sharedRemote),projectSharedRemote:row=>structuredClone(row.state),
    initializeMainHead:async options=>{calls.push(`main-init:${options.intent}`);assert.equal(options.intent,'upload-owner');return {ok:true}},
    initializeSharedHead:async options=>{calls.push(`shared-init:${options.intent}`);assert.equal(options.intent,'upload-owner');assert.deepEqual(options.state.bankEvents,sharedSource.bankEvents);return {ok:true}},
    syncMain:async()=>{calls.push('main-sync');mainRemote={revision:1,state:structuredClone(mainSource)};mainCloud=settled(1,mainSource);return true},
    syncShared:async()=>{calls.push('shared-sync');sharedRemote={revision:1,state:structuredClone(sharedSource)};sharedCloud=settled(1,sharedSource);return true},
    readMainCloudState:async()=>structuredClone(mainCloud),readSharedCloudState:async()=>structuredClone(sharedCloud),
    freeze:async()=>{calls.push('freeze');return true},drainLegacy:async()=>{calls.push('drain');return {clean:true}},verifyLegacyClean:async()=>true,
    markCutover:async()=>{calls.push('mark');marker=true},verifyCutover:async()=>marker,
  });
  await transition.hydrate();
  const result=await transition.begin();
  assert.equal(result.phase,'complete');assert.equal(marker,true);
  assert.ok(calls.includes('auth:account-A'));assert.ok(calls.includes('main-init:upload-owner'));assert.ok(calls.includes('shared-init:upload-owner'));
  assert.ok(calls.indexOf('freeze')<calls.indexOf('drain'));assert.ok(calls.indexOf('main-sync')<calls.indexOf('mark'));assert.ok(calls.indexOf('shared-sync')<calls.indexOf('mark'));
});


test('production transition treats the durable local namespace as normal startup, not an account cutover',async()=>{
  const calls=[];
  const ownerBinding={
    current:()=> 'local',
    assertAuthenticatedOwner(){calls.push('auth');throw new Error('auth must not be consulted for local startup')},
  };
  const bootstrapCoordinator={
    get ready(){return false},get hasGroup(){return false},get group(){return null},
    async load(){calls.push('bootstrap-load');throw new Error('bootstrap must not load for local startup')},
    async prepare(){throw new Error('unused')},async advance(){throw new Error('unused')},
  };
  const transition=createStorageV2ProductionTransition({
    app:'orders',ownerBinding,primary:()=>true,online:()=>true,authOwner:()=>null,bootstrapCoordinator,cutoverDb:durableDb(),
    readMainState:()=>({}),projectMainState:value=>value,emptyMainState:()=>({}),readSharedState:()=>({checks:[],bankEvents:[]}),
    readMainRemote:async()=>null,readSharedRemote:async()=>null,initializeMainHead:async()=>{},initializeSharedHead:async()=>{},syncMain:async()=>true,syncShared:async()=>true,
    readMainCloudState:async()=>null,readSharedCloudState:async()=>null,freeze:async()=>{},drainLegacy:async()=>{},verifyLegacyClean:async()=>true,markCutover:async()=>{},verifyCutover:async()=>false,
  });
  assert.equal(await transition.hydrate(),null);
  assert.equal(transition.ready,true);
  assert.equal(transition.preparing,false);
  assert.equal(transition.record,null);
  assert.equal(transition.bootstrapGroup,null);
  assert.equal(await transition.resume(),null);
  assert.deepEqual(calls,[]);
  assert.throws(()=>transition.begin(),/storage_cutover_account_owner_required/);
});

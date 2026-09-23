import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncDocument} from '../netunim-orders/site/assets/js/sync/document.js';
import {CLOUD_BASE_KEY} from '../netunim-orders/site/assets/js/state/constants.js';

const clone=structuredClone,noop=()=>{};
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}

function fixture({rpcSave,readCloud=async()=>null,merge3=(_base,local)=>({state:clone(local),conflicts:[]}),failRefreshAfterAck=false}={}){
  const base={notes:[{id:'A',content:'base'}]},model={state:{notes:[{id:'A',content:'sent'}]}},session={localGeneration:1,cloudRevision:10,lastCloudState:clone(base),cloudSaveRequested:false,cloudConflictBlocked:false,cloudBusy:false};
  let seq=1,ackSeq=0,revision=10,baseState=clone(base),flight=null,control=null,op=0;
  const sent=[],acks=[],rejects=[],legacyWrites=[];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  globalThis.localStorage={getItem:()=>null,setItem:(key)=>legacyWrites.push(key),removeItem:noop};
  const state=()=>({seq,base:{revision,state:clone(baseState),ackSeq},flight:flight&&clone(flight),control:control&&clone(control),pending:seq>ackSeq,pendingDeleteIntents:{},pendingGeneration:seq,pendingMutationType:'edit',pendingSurface:'orders',afterFlightPending:!!flight&&seq>flight.endSeq,afterFlightDeleteIntents:{},afterFlightGeneration:seq,afterFlightMutationType:'edit',afterFlightSurface:'orders'});
  const materialize=async({throughSeq,snapshot}={})=>{
    if(flight)return clone(flight);const end=throughSeq??seq;if(end===ackSeq)return null;
    flight={version:2,operationId:`op-${++op}`,baseRevision:revision,startSeq:ackSeq+1,endSeq:end,snapshot:clone(snapshot??model.state),deleteIntents:{},generation:end,mutationType:'edit',surface:'orders'};return clone(flight)
  };
  const acknowledge=async(operationId,newRevision,cloud,{currentState,control:nextControl=null}={})=>{
    assert.equal(operationId,flight?.operationId);acks.push({operationId,newRevision,cloud:clone(cloud),currentState:clone(currentState),control:clone(nextControl)});ackSeq=flight.endSeq;revision=newRevision;baseState=clone(cloud);flight=null;control=nextControl&&clone(nextControl);return state()
  };
  const reject=async(operationId,newRevision,cloud,{control:nextControl=null}={})=>{
    assert.equal(operationId,flight?.operationId);rejects.push({operationId,newRevision,cloud:clone(cloud),control:clone(nextControl)});revision=newRevision;baseState=clone(cloud);flight=null;control=nextControl&&clone(nextControl);return state()
  };
  const wrappedRpc=async(...args)=>{sent.push({snapshot:clone(args[0]),expected:args[1],operationId:args[2]});return rpcSave?rpcSave(...args):{r:{ok:true},row:{revision:args[1]+1,state:clone(args[0]),updated_at:'2026-09-22T00:00:00Z'}}};
  const refreshState=async()=>{if(failRefreshAfterAck&&acks.length)throw new Error('injected post-ACK refresh failure');return state()};
  const api=createSyncDocument({model,files:{},session,ui:{},tab:{primaryTab:true},normalizeState:clone,localSnapshot:()=>true,markCloudPending:()=>{throw new Error('legacy outbox must not be used')},getCloudPending:async()=>null,clearCloudPending:async()=>true,toast:noop,setCloud:noop,prepareCloudState:(value=model.state)=>clone(value),writeStateToFolder:async()=>{},readCloud,rpcSave:wrappedRpc,merge3,applyOrderCloudState:value=>{model.state=clone(value)},cloudPendingExists:()=>seq>ackSeq,setSave:noop,cloudEnabled:()=>true,loadCloudPendingState:()=>null,sameOrderCloudData:(a,b)=>JSON.stringify(a)===JSON.stringify(b),cloudHasLocalWork:()=>seq>ackSeq,render:noop,readCloudMeta:async()=>null,refreshKupaReadout:async()=>true,pollSharedChecks:async()=>{},refreshCloudTimestamp:noop,storageV2CloudOutboxActive:()=>true,refreshStorageV2CloudState:refreshState,materializeStorageV2CloudFlight:materialize,acknowledgeStorageV2CloudFlight:acknowledge,rejectStorageV2CloudFlight:reject,setStorageV2CloudControl:async value=>{control=clone(value);return clone(value)},storageV2CommitPromise:()=>Promise.resolve()});
  return {api,model,session,sent,acks,rejects,legacyWrites,getState:state,getControl:()=>clone(control),mutate(value){model.state=clone(value);seq++;session.localGeneration++},setControl(value){control=clone(value)}};
}

test('Orders V2 keeps the exact immutable flight across a lost ACK retry',async()=>{
  let calls=0;const f=fixture({rpcSave:async(snapshot,expected)=>{if(++calls===1)throw new TypeError('Failed to fetch');return {r:{ok:true},row:{revision:expected+1,state:clone(snapshot)}}}});
  assert.equal(await f.api.requestCloudSave('first'),false);assert.equal(f.sent.length,1);const firstId=f.sent[0].operationId;assert.ok(f.getState().flight,'lost ACK must keep the durable flight');
  assert.equal(await f.api.requestCloudSave('retry'),true);assert.equal(f.sent.length,2);assert.equal(f.sent[1].operationId,firstId);assert.equal(f.getState().flight,null);assert.equal(f.getState().pending,false);assert.equal(f.legacyWrites.includes(CLOUD_BASE_KEY),false,'V2 ACK must not mirror a full cloud base to localStorage');
});

test('Orders V2 confirmed revision conflict rejects the old flight and rotates operation id after rebase',async()=>{
  let calls=0;const remote={notes:[{id:'A',content:'remote'}]};
  const f=fixture({readCloud:async()=>({revision:11,state:clone(remote)}),merge3:(_base,_local,remoteState)=>({state:{notes:[{id:'A',content:`merged-${remoteState.notes[0].content}`}]},conflicts:[]}),rpcSave:async(snapshot,expected)=>{if(++calls===1)return {r:{ok:false,status:409},j:{code:'PT409',message:'revision_conflict'}};return {r:{ok:true},row:{revision:expected+1,state:clone(snapshot)}}}});
  assert.equal(await f.api.requestCloudSave('sync'),true);assert.equal(f.sent.length,2);assert.equal(f.sent[0].expected,10);assert.equal(f.sent[1].expected,11);assert.notEqual(f.sent[0].operationId,f.sent[1].operationId);assert.equal(f.rejects.length,1);assert.equal(f.rejects[0].operationId,f.sent[0].operationId);assert.equal(f.acks[0].operationId,f.sent[1].operationId);assert.equal(f.model.state.notes[0].content,'merged-remote');assert.equal(f.legacyWrites.includes(CLOUD_BASE_KEY),false,'V2 rebase must keep its cloud base in IndexedDB');
});


test('Orders V2 does not turn a committed ACK into a retry when a later cache refresh is unavailable',async()=>{
  const f=fixture({failRefreshAfterAck:true});
  assert.equal(await f.api.requestCloudSave('sync'),true);assert.equal(f.sent.length,1);assert.equal(f.acks.length,1);assert.equal(f.getState().flight,null);assert.equal(f.getState().pending,false);assert.equal(f.getControl(),null);
});

test('Orders V2 ACK checkpoints edits that arrived during RPC while advancing cursor only through the flight',async()=>{
  const started=deferred(),release=deferred();let calls=0;
  const f=fixture({rpcSave:async(snapshot,expected)=>{calls++;if(calls===1){started.resolve();await release.promise}return {r:{ok:true},row:{revision:expected+1,state:clone(snapshot)}}},merge3:(_base,local)=>({state:clone(local),conflicts:[]})});
  const saving=f.api.requestCloudSave('sync');await started.promise;f.mutate({notes:[{id:'A',content:'later'}]});release.resolve();
  assert.equal(await saving,true);assert.equal(f.sent.length,2);assert.notEqual(f.sent[0].operationId,f.sent[1].operationId);assert.equal(f.acks.length,2);assert.equal(f.acks[0].currentState.notes[0].content,'later');assert.equal(f.acks[0].newRevision,11);assert.equal(f.acks[1].newRevision,12);assert.equal(f.model.state.notes[0].content,'later');assert.equal(f.getState().pending,false);
});

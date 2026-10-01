import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageV2BootstrapCoordinator} from '../shared/storage-v2-bootstrap.js';
import {createStorageV2DetachedTarget} from '../shared/storage-v2-detached-target.js';

const copy=value=>value==null?value:structuredClone(value);
function fixture({remoteMain=null,remoteShared=null,sourceChecks=[{id:'check-1'}],loseMainAck=false,loseSharedAck=false}={}){
  const groups=new Map(),calls={main:[],shared:[]},mainIds=new Map(),sharedIds=new Map();
  let mainRow=copy(remoteMain),sharedRow=copy(remoteShared),mainLocal=null,sharedLocal=null,mainHead=null,sharedHead=null,mainFlight=null,sharedFlight=null,loseAck=loseMainAck,loseChecksAck=loseSharedAck,marker=false;
  const db={
    async readBootstrapGroup(scope){return copy(groups.get(scope)||null)},
    async beginBootstrapGroup(scope,row){const existing=groups.get(scope);if(existing&&existing.phase!=='complete')throw Error('storage_bootstrap_group_pending');groups.set(scope,copy(row));return copy(row)},
    async advanceBootstrapGroup(scope,id,from,to,patch){const current=groups.get(scope);if(!current||current.id!==id||current.phase!==from)throw Error('storage_bootstrap_phase_invalid');const updated={...current,...copy(patch),phase:to};groups.set(scope,updated);return copy(updated)},
  };
  const main={
    async recover(){return mainLocal?{state:copy(mainLocal),seq:mainHead.seq}:null},
    async initializeCloudHead(rev,full,{cloudState,appMetadata}){
      if(mainLocal){if(mainHead.operationId===appMetadata.bootstrapOperationId)return this.recover();throw Error('storage_initialization_exists')}
      mainLocal=copy(full);mainHead={seq:0,base:{revision:rev,state:copy(cloudState),ackSeq:0},operationId:appMetadata.bootstrapOperationId};return this.recover();
    },
    async initializeFirstCloudHead(_empty,full,{cloudState,appMetadata}){
      if(mainLocal){if(mainHead.operationId===appMetadata.bootstrapOperationId)return this.recover();throw Error('storage_initialization_exists')}
      mainLocal=copy(full);mainHead={seq:1,base:{revision:0,state:copy(cloudState),ackSeq:0},operationId:appMetadata.bootstrapOperationId};return this.recover();
    },
    async cloudState(){return mainHead?copy({seq:mainHead.seq,base:mainHead.base,flight:mainFlight,pending:mainHead.seq>mainHead.base.ackSeq,control:null}):null},
    async materializeFlight({operationId,project,prepareAudit}){
      if(mainFlight)return copy(mainFlight);
      if(mainHead.seq===mainHead.base.ackSeq)return null;
      mainFlight={operationId,baseRevision:mainHead.base.revision,snapshot:project(mainLocal),deleteIntents:{},audit:{}};
      mainFlight.audit=prepareAudit(copy(mainFlight));return copy(mainFlight);
    },
    async acknowledgeFlight(id,rev,state){assert.equal(mainFlight?.operationId,id);mainHead.base={revision:rev,state:copy(state),ackSeq:mainHead.seq};mainFlight=null;return true},
  };
  const rpcMain=async(snapshot,baseRevision,id)=>{
    calls.main.push({snapshot:copy(snapshot),baseRevision,id});
    if(mainIds.has(id))return {r:{ok:true},row:copy(mainIds.get(id))};
    if(mainRow||baseRevision!==0)throw Error('unexpected-main-rpc');
    mainRow={revision:1,state:copy(snapshot)};mainIds.set(id,copy(mainRow));
    if(loseAck){loseAck=false;throw Error('lost-main-ack')}
    return {r:{ok:true},row:copy(mainRow)};
  };
  const rpcShared=async(checks,baseRevision,id)=>{
    calls.shared.push({checks:copy(checks),baseRevision,id});
    if(sharedIds.has(id))return {r:{ok:true},row:copy(sharedIds.get(id))};
    if(sharedRow||baseRevision!==0)throw Error('unexpected-shared-rpc');
    sharedRow={revision:1,state:{checks:copy(checks),bankEvents:[]}};sharedIds.set(id,copy(sharedRow));
    if(loseChecksAck){loseChecksAck=false;throw Error('lost-shared-ack')}
    return {r:{ok:true},row:copy(sharedRow)};
  };
  const shared={
    async recover(){return sharedLocal?{state:copy(sharedLocal),seq:sharedHead.seq}:null},
    async initialize({state,revision,intent,bootstrapOperationId}){
      if(sharedLocal){if(sharedHead.operationId===bootstrapOperationId)return this.recover();throw Error('storage_initialization_exists')}
      sharedLocal=copy(state);const pending=intent==='upload-local'&&state.checks.length>0;
      sharedHead={seq:pending?state.checks.length:0,base:{revision,state:intent==='upload-local'?{checks:[],bankEvents:[]}:copy(state),ackSeq:0},operationId:bootstrapOperationId};return this.recover();
    },
    async cloudState(){return sharedHead?copy({seq:sharedHead.seq,base:sharedHead.base,flight:sharedFlight,pending:sharedHead.seq>sharedHead.base.ackSeq,control:null}):null},
    async sync(){
      if(sharedHead.seq>sharedHead.base.ackSeq){
        sharedFlight??={operationId:'fixed-shared-flight',snapshot:copy(sharedLocal),baseRevision:sharedHead.base.revision};
        const result=await rpcShared(sharedFlight.snapshot.checks,sharedFlight.baseRevision,sharedFlight.operationId);
        sharedHead.base={revision:result.row.revision,state:copy(result.row.state),ackSeq:sharedHead.seq};sharedFlight=null;return true;
      }
      if(!sharedRow)throw Error('shared remote missing');
      sharedLocal=copy(sharedRow.state);sharedHead.base={revision:sharedRow.revision,state:copy(sharedRow.state),ackSeq:sharedHead.seq};return true;
    },
  };
  const source={main:{state:{rows:[{id:'local-row'}]},fullState:{rows:[{id:'local-row'}],checks:copy(sourceChecks)},seq:4},shared:{state:{checks:copy(sourceChecks),bankEvents:[]},seq:3}};
  const context={app:'orders',sourceOwner:'local',targetOwner:'target-account',intent:'upload-local',transferId:'transfer-id',source};
  const factory=()=>{
    const bootstrapCoordinator=createStorageV2BootstrapCoordinator({app:'orders',owner:()=> 'target-account',primary:()=>true,db,operationId:()=> 'transfer-id'});
    return createStorageV2DetachedTarget({app:'orders',targetOwner:'target-account',primary:()=>true,main,shared,bootstrapCoordinator,
      cutoverMarker:{mark:async({verifyLegacyClean})=>{assert.equal(await verifyLegacyClean(),true);marker=true},verify:async()=>marker},
      readMainRemote:async()=>copy(mainRow),projectMainRemote:row=>copy(row.state),readSharedRemote:async()=>copy(sharedRow),projectSharedRemote:row=>copy(row.state),
      composeMainState:(state,checks)=>({...copy(state),checks:copy(checks.checks)}),projectMainState:full=>({rows:copy(full.rows)}),emptyMainState:()=>({rows:[],checks:[]}),validateMainCloud:state=>assert.ok(Array.isArray(state.rows)),
      rpcMain,rpcShared,verifyLegacyClean:async()=>true});
  };
  return {factory,context,calls,source,get mainRow(){return copy(mainRow)},get sharedRow(){return copy(sharedRow)},get marker(){return marker},get group(){return copy(groups.get('orders:target-account')||null)}};
}

test('first V2 upload creates Main and Shared cloud heads, including an empty Shared document',async()=>{
  const f=fixture({sourceChecks:[]}),target=f.factory(),group=await target.prepare(f.context);
  assert.equal(group.phase,'complete');assert.equal(f.calls.main.length,1);assert.equal(f.calls.shared.length,1);
  assert.deepEqual(f.sharedRow.state,{checks:[],bankEvents:[]});
  const proof=await target.verify();assert.equal(proof.clean,true);assert.equal(proof.mainRevision,1);assert.equal(proof.sharedRevision,1);
  await target.mark();assert.equal(await target.verifyMarker(),true);
});

test('lost Main ACK keeps the immutable flight and retries its operation ID after restart',async()=>{
  const f=fixture({loseMainAck:true}),target=f.factory();
  await assert.rejects(target.prepare(f.context),/lost-main-ack/);
  assert.equal(f.group.phase,'shared-initialized');assert.equal(f.mainRow.revision,1,'server committed despite lost response');
  const resumed=f.factory();assert.equal((await resumed.load()).id,f.context.transferId);
  assert.equal((await resumed.resume(f.context)).phase,'complete');
  assert.equal(f.calls.main.length,2);assert.equal(f.calls.main[0].id,f.calls.main[1].id);assert.deepEqual(f.calls.main[0].snapshot,f.calls.main[1].snapshot);
  assert.equal(f.calls.shared.length,1);assert.deepEqual(f.calls.shared[0].checks,[{id:'check-1'}]);
  assert.equal((await resumed.verify()).clean,true);
});

test('load-account reconstructs the detached target without uploading local data',async()=>{
  const f=fixture({remoteMain:{revision:7,state:{rows:[{id:'cloud-row'}]}},remoteShared:{revision:9,state:{checks:[{id:'cloud-check'}],bankEvents:[{id:'event'}]}}});
  const ctx={...f.context,intent:'load-account'},target=f.factory();
  assert.equal((await target.prepare(ctx)).phase,'complete');
  const proof=await target.verify();assert.deepEqual(proof.mainState.rows,[{id:'cloud-row'}]);assert.deepEqual(proof.sharedState.checks,[{id:'cloud-check'}]);
  assert.equal(f.calls.main.length,0);assert.equal(f.calls.shared.length,0);
});

test('lost Shared ACK is retried with the same immutable check operation after restart',async()=>{
  const f=fixture({loseSharedAck:true}),target=f.factory();
  await assert.rejects(target.prepare(f.context),/lost-shared-ack/);
  assert.equal(f.group.phase,'main-synced');assert.equal(f.sharedRow.revision,1);
  const resumed=f.factory();assert.equal((await resumed.resume(f.context)).phase,'complete');
  assert.equal(f.calls.shared.length,2);assert.equal(f.calls.shared[0].id,f.calls.shared[1].id);assert.deepEqual(f.calls.shared[0].checks,f.calls.shared[1].checks);
  assert.equal((await resumed.verify()).clean,true);
});

test('upload-local stops before any target write when existing Shared differs',async()=>{
  const f=fixture({remoteShared:{revision:4,state:{checks:[{id:'other-check'}],bankEvents:[]}}}),target=f.factory();
  await assert.rejects(target.prepare(f.context),/storage_bootstrap_shared_reconciliation_required/);
  assert.equal(f.calls.main.length,0);assert.equal(f.calls.shared.length,0);assert.equal(f.group,null);
});

test('upload-local replaces a stale Main checks copy from the Shared source',async()=>{
  const f=fixture({sourceChecks:[{id:'authoritative'}]});
  f.context.source.main.fullState.checks=[{id:'stale'}];
  const target=f.factory();await target.prepare(f.context);
  const proof=await target.verify();
  assert.deepEqual(proof.mainState.checks,[{id:'authoritative'}]);
  assert.deepEqual(proof.sharedState.checks,[{id:'authoritative'}]);
});

import {createStorageV2BootstrapCoordinator,createStorageV2BootstrapExecutor,storageV2BootstrapStateHash} from './storage-v2-bootstrap.js';
import {createStorageV2Cutover} from './storage-v2-cutover.js';
import {cloudWriteError,equalSyncJson,operationAuditMetadata,runBusyCloudWriteWithPolicy} from './cloud-sync.js';

const copy=value=>value==null?value:structuredClone(value);
const sharedState=value=>{
  if(!value||!Array.isArray(value.checks)||!Array.isArray(value.bankEvents))throw new Error('storage_transfer_shared_state_invalid');
  return {checks:copy(value.checks),bankEvents:copy(value.bankEvents)};
};
const revision=row=>Number.isSafeInteger(Number(row?.revision))&&Number(row.revision)>=0?Number(row.revision):null;

// An account target is built with fixed-owner runtimes. Nothing in this adapter
// reads owner.current() or writes the displayed model before owner activation.
// The bootstrap group freezes remote discovery before the first RPC, so a lost
// ACK can only resend the same journal flight and operation ID.
export function createStorageV2DetachedTarget({
  app,targetOwner,primary,main,shared,readMainRemote,projectMainRemote,
  readSharedRemote,projectSharedRemote,composeMainState,projectMainState,
  emptyMainState,validateMainCloud,rpcMain,rpcShared,verifyLegacyClean,
  bootstrapCoordinator=null,cutoverMarker=null,
}={}){
  if(!['orders','kupa'].includes(app)||!String(targetOwner||'').trim()||targetOwner==='local'||
    [primary,main?.recover,main?.initializeCloudHead,main?.initializeFirstCloudHead,main?.cloudState,main?.materializeFlight,main?.acknowledgeFlight,
      shared?.recover,shared?.initialize,shared?.sync,shared?.cloudState,readMainRemote,projectMainRemote,readSharedRemote,projectSharedRemote,
      composeMainState,projectMainState,emptyMainState,validateMainCloud,rpcMain,rpcShared,verifyLegacyClean].some(fn=>typeof fn!=='function'))throw new Error('storage_transfer_target_configuration');
  const owner=()=>targetOwner,guard=()=>{if(!primary())throw new Error('storage_transfer_target_primary_required')};
  const bootstrap=bootstrapCoordinator||createStorageV2BootstrapCoordinator({app,owner,primary});
  const cutover=cutoverMarker||createStorageV2Cutover({app,owner,primary});
  function remoteMain(row){const state=projectMainRemote(row);validateMainCloud(state);return state}
  function remoteShared(row){return sharedState(projectSharedRemote(row))}
  async function assertRemote(side,read,project){
    const row=await read();guard();
    if(!row||revision(row)!==side.remoteRevision)throw new Error(`storage_transfer_${side.role}_remote_changed`);
    const state=project(row),hash=await storageV2BootstrapStateHash(side.role,state);
    if(hash!==side.remoteHash)throw new Error(`storage_transfer_${side.role}_remote_changed`);
    return state;
  }
  async function alreadyMain(side,cloudState){
    const recovered=await main.recover(null);guard();
    if(!recovered)return false;
    const cloud=await main.cloudState({validateBase:validateMainCloud});guard();
    if(!cloud?.base||cloud.flight||cloud.control||cloud.pending||cloud.base.revision!==side.remoteRevision||
      !equalSyncJson(cloud.base.state,cloudState)||!equalSyncJson(projectMainState(recovered.state),cloudState))throw new Error('storage_transfer_main_existing_head_unsettled');
    return true;
  }
  async function alreadyShared(side,cloudState){
    let recovered;
    try{recovered=await shared.recover()}catch(error){
      // A verified shadow checkpoint may still need promotion by initialize().
      if(error?.message==='shared_checks_storage_role_mismatch')return false;
      throw error;
    }
    guard();if(!recovered)return false;
    const cloud=await shared.cloudState();guard();
    if(!cloud?.base||cloud.flight||cloud.control||cloud.pending||cloud.base.revision!==side.remoteRevision||
      !equalSyncJson(sharedState(cloud.base.state),cloudState)||!equalSyncJson(sharedState(recovered.state),cloudState))throw new Error('storage_transfer_shared_existing_head_unsettled');
    return true;
  }
  let context=null;
  function use(ctx){
    guard();if(ctx?.targetOwner!==targetOwner||ctx.app!==app||!ctx.transferId||!ctx.source?.main||!ctx.source?.shared)throw new Error('storage_transfer_target_context_invalid');
    context=ctx;return ctx;
  }
  const executor=createStorageV2BootstrapExecutor({coordinator:bootstrap,primary,
    initializeMain:async(side,group)=>{
      guard();const ctx=context;if(!ctx||group.id!==ctx.transferId)throw new Error('storage_transfer_target_context_invalid');
      if(side.intent==='cloud-authoritative'){
        const state=await assertRemote(side,readMainRemote,remoteMain);
        if(await alreadyMain(side,state))return {existing:true,revision:side.remoteRevision};
        const sharedRow=await readSharedRemote();guard();if(!sharedRow)throw new Error('storage_transfer_shared_remote_missing');
        const full=composeMainState(state,remoteShared(sharedRow));
        await main.initializeCloudHead(side.remoteRevision,full,{intent:'cloud-authoritative',sourceOwner:targetOwner,cloudState:state,validateBase:validateMainCloud,appMetadata:{bootstrapOperationId:side.operationId}});
        return {revision:side.remoteRevision};
      }
      if(side.intent!=='upload-local'||await readMainRemote())throw new Error('storage_transfer_main_upload_target_changed');
      const original=ctx.source.main.fullState;
      if(!original||!equalSyncJson(projectMainState(original),ctx.source.main.state))throw new Error('storage_transfer_main_source_full_missing');
      // Main checkpoints still carry a transitional checks copy. Shared is the
      // sole authority, including when that copy lagged before the transfer.
      const full={...copy(original),checks:copy(sharedState(ctx.source.shared.state).checks)};
      const empty=emptyMainState(),base=projectMainState(empty);validateMainCloud(base);
      await main.initializeFirstCloudHead(empty,full,{sourceOwner:'local',cloudState:base,validateBase:validateMainCloud,appMetadata:{bootstrapOperationId:side.operationId}});
      return {revision:0,pending:true};
    },
    initializeShared:async(side,group)=>{
      guard();const ctx=context;if(!ctx||group.id!==ctx.transferId)throw new Error('storage_transfer_target_context_invalid');
      if(side.intent==='cloud-authoritative'){
        const state=await assertRemote(side,readSharedRemote,remoteShared);
        if(await alreadyShared(side,state))return {existing:true,revision:side.remoteRevision};
        await shared.initialize({state,revision:side.remoteRevision,intent:'cloud-authoritative',sourceOwner:targetOwner,bootstrapOperationId:side.operationId});
        return {revision:side.remoteRevision};
      }
      if(side.intent!=='upload-local'||await readSharedRemote())throw new Error('storage_transfer_shared_upload_target_changed');
      const source=sharedState(ctx.source.shared.state);
      if(source.bankEvents.length)throw new Error('storage_transfer_shared_bank_events_reconciliation_required');
      await shared.initialize({state:source,revision:0,intent:'upload-local',sourceOwner:'local',bootstrapOperationId:side.operationId});
      return {revision:0,pending:source.checks.length>0};
    },
    syncMain:async(side)=>{
      guard();const cloud=await main.cloudState({validateBase:validateMainCloud});guard();if(!cloud?.base||cloud.control)throw new Error('storage_transfer_main_head_unavailable');
      if(!cloud.pending&&!cloud.flight)return {clean:true};
      const flight=await main.materializeFlight({operationId:side.operationId,baseRevision:cloud.base.revision,project:projectMainState,validateCloud:validateMainCloud,
        prepareAudit:value=>operationAuditMetadata({site:app,mutationType:'migration',surface:'owner-transfer',baseRevision:value.baseRevision,beforeState:cloud.base.state,afterState:value.snapshot,collections:[],deleteCount:0})});
      guard();if(!flight)return {clean:true};
      const result=await runBusyCloudWriteWithPolicy(()=>rpcMain(copy(flight.snapshot),flight.baseRevision,flight.operationId,copy(flight.deleteIntents||{}),copy(flight.audit||{})));
      guard();if(!result?.r?.ok)throw cloudWriteError(result,'storage_transfer_main_rpc_failed');
      const row=result.row;if(revision(row)===null||revision(row)<=flight.baseRevision)throw new Error('storage_transfer_main_ack_invalid');
      const authoritative=remoteMain(row);
      if(!equalSyncJson(authoritative,flight.snapshot))throw new Error('storage_transfer_main_rpc_state_changed');
      await main.acknowledgeFlight(flight.operationId,revision(row),authoritative,{validateBase:validateMainCloud});
      guard();return {clean:true,revision:revision(row),operationId:flight.operationId};
    },
    syncShared:async(side)=>{
      guard();const cloud=await shared.cloudState();guard();if(!cloud?.base||cloud.control)throw new Error('storage_transfer_shared_head_unavailable');
      // An empty first document has no journal operation, so materializing a
      // flight would return null. The durable bootstrap side ID is its stable
      // RPC identity; restart reads the document before repeating the RPC.
      if(side.intent==='upload-local'&&!cloud.pending&&!cloud.flight){
        const row=await readSharedRemote();guard();
        if(!row){
          const snapshot=sharedState(context.source.shared.state);
          if(snapshot.checks.length||snapshot.bankEvents.length)throw new Error('storage_transfer_shared_empty_bootstrap_mismatch');
          const audit=operationAuditMetadata({site:app,mutationType:'migration',surface:'owner-transfer',baseRevision:0,beforeState:{checks:[],bankEvents:[]},afterState:snapshot,collections:['checks']});
          const result=await runBusyCloudWriteWithPolicy(()=>rpcShared([],0,side.operationId,[],audit));guard();
          if(!result?.r?.ok){
            const remote=await readSharedRemote();guard();
            if(!remote||!equalSyncJson(remoteShared(remote),snapshot))throw cloudWriteError(result,'storage_transfer_shared_first_rpc_failed');
          }
        }else if(!equalSyncJson(remoteShared(row),sharedState(context.source.shared.state)))throw new Error('storage_transfer_shared_remote_changed');
      }
      const ok=await shared.sync();guard();if(ok!==true)throw new Error('storage_transfer_shared_sync_incomplete');return {clean:true};
    },
    verify:async()=>{const proof=await verify();return {mainRevision:proof.mainRevision,sharedRevision:proof.sharedRevision}},
  });
  async function load(){guard();return bootstrap.load()}
  async function prepare(ctx){
    use(ctx);const [mainRow,sharedRow]=await Promise.all([readMainRemote(),readSharedRemote()]);guard();
    const mainRemote=mainRow?{state:remoteMain(mainRow),revision:revision(mainRow)}:null,
      sharedRemote=sharedRow?{state:remoteShared(sharedRow),revision:revision(sharedRow)}:null;
    if(mainRow&&mainRemote.revision===null||sharedRow&&sharedRemote.revision===null)throw new Error('storage_transfer_remote_revision_invalid');
    const options={id:ctx.transferId,sourceOwner:ctx.sourceOwner,transferIntent:ctx.intent,
      mainSource:{state:ctx.source.main.state,seq:ctx.source.main.seq},sharedSource:{state:sharedState(ctx.source.shared.state),seq:ctx.source.shared.seq},
      mainRemote,sharedRemote};
    const group=await bootstrap.prepare(options);guard();
    if(group.id!==ctx.transferId)throw new Error('storage_transfer_bootstrap_id_mismatch');
    return executor.resume();
  }
  async function resume(ctx){use(ctx);const group=await bootstrap.load();guard();if(!group)return null;if(group.id!==ctx.transferId)throw new Error('storage_transfer_bootstrap_id_mismatch');return executor.resume()}
  async function verify(){
    guard();const [mainRecovered,sharedRecovered]=await Promise.all([main.recover(null),shared.recover()]);guard();
    const [mainCloud,sharedCloud,mainRow,sharedRow]=await Promise.all([main.cloudState({validateBase:validateMainCloud}),shared.cloudState(),readMainRemote(),readSharedRemote()]);guard();
    if(!mainRecovered||!sharedRecovered||!mainCloud?.base||!sharedCloud?.base||!mainRow||!sharedRow)throw new Error('storage_transfer_target_head_missing');
    const sides=[{role:'main',cloud:mainCloud,row:mainRow,local:projectMainState(mainRecovered.state),remote:remoteMain(mainRow)},
      {role:'shared',cloud:sharedCloud,row:sharedRow,local:sharedState(sharedRecovered.state),remote:remoteShared(sharedRow)}];
    for(const side of sides){
      if(side.cloud.pending||side.cloud.flight||side.cloud.control||side.cloud.base.ackSeq!==side.cloud.seq||revision(side.row)!==side.cloud.base.revision||
        !equalSyncJson(side.cloud.base.state,side.remote)||!equalSyncJson(side.local,side.remote))throw new Error(`storage_transfer_${side.role}_target_not_clean`);
    }
    return {clean:true,mainRevision:revision(mainRow),sharedRevision:revision(sharedRow),mainState:copy(mainRecovered.state),sharedState:sharedState(sharedRecovered.state)};
  }
  async function mark(){guard();await verify();await cutover.mark({verifyLegacyClean});guard();return true}
  return {load,prepare,resume,verify,mark,verifyMarker:()=>cutover.verify()};
}

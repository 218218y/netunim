import {measureStorage} from '../shared/storage-metrics.js';
import {beginMeasure} from '../shared/runtime-performance.js';
import {createIndexedDbConnection} from '../shared/indexed-db-connection.js';
import {clone} from '../core/values.js';
import {LOCAL_DB} from '../state/constants.js';
import {createOperationId} from '../shared/cloud-sync.js';
import {assertOrderEntityInvariants,assertValidOrderCloudState} from '../state/validation.js';

const LOCAL_SYNC_STORE='sync';
const RESTORE_GROUP_KEY='orders.restore.group.v1';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageBrowser({storageV2=null,captureEmbeddedWorkbook=async()=>{},model, files, session, prepareCloudState, normalizeState, domainRevisions}){
let v2CloudStateCache=null;
function nextSnapshotSequence(){
  return session.localSnapshotSeq=Number(session.localSnapshotSeq||0)+1;
}

function localSnapshot(source=model.state,options){const done=beginMeasure('orders:local-snapshot');try{
  if(session.storageProtocolBlocked)throw new Error('storage_protocol_verification_required');
  measureStorage('validate',()=>assertOrderEntityInvariants(source,{includeChecks:true,required:true}));nextSnapshotSequence();const appMetadata={snapshotSeq:session.localSnapshotSeq,revision:Number(session.cloudRevision||0)};
  const fast=storageV2?.persist?.(source,options,appMetadata);if(!fast?.handled)throw new Error('storage_v2_write_unavailable');
  files.storageV2CommitPromise=fast.committed;if(fast.seq&&v2CloudStateCache?.base){session.storageV2CloudPending=true;v2CloudStateCache={...v2CloudStateCache,seq:Math.max(Number(v2CloudStateCache.seq||0),Number(fast.seq)),pending:true}}return fast.emergencyDurable
}finally{done()}}

const openRestoreDb=createIndexedDbConnection(LOCAL_DB,2,db=>{if(!db.objectStoreNames.contains(LOCAL_SYNC_STORE))db.createObjectStore(LOCAL_SYNC_STORE)});

async function restoreDbExists(){
  // Avoid creating the restore-group database just to check for a group.
  if(typeof globalThis.indexedDB?.databases!=='function')return true;
  const entries=await globalThis.indexedDB.databases();
  if(!Array.isArray(entries))throw new Error('orders_restore_database_inventory_failed');
  return entries.some(entry=>entry?.name===LOCAL_DB);
}

function restoreGroupStorageKey(key){
  const value=String(key||''),current=`${RESTORE_GROUP_KEY}:current`,archivePrefix=`${RESTORE_GROUP_KEY}:archive:`;
  if(value===current||(value.startsWith(archivePrefix)&&value.length>archivePrefix.length))return value;
  throw new Error('storage_restore_group_key_required');
}
async function idbSyncPut(key,value){const restoreKey=restoreGroupStorageKey(key);const db=await openRestoreDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(LOCAL_SYNC_STORE,'readwrite');tx.objectStore(LOCAL_SYNC_STORE).put(value,restoreKey);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB sync write aborted'))})}
async function idbSyncGet(key){const restoreKey=restoreGroupStorageKey(key);if(!await restoreDbExists())return null;const db=await openRestoreDb();return await new Promise((resolve,reject)=>{const r=db.transaction(LOCAL_SYNC_STORE,'readonly').objectStore(LOCAL_SYNC_STORE).get(restoreKey);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error)})}
async function idbSyncDelete(key){const restoreKey=restoreGroupStorageKey(key);const db=await openRestoreDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(LOCAL_SYNC_STORE,'readwrite');tx.objectStore(LOCAL_SYNC_STORE).delete(restoreKey);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB sync delete aborted'))})}

async function recoverLocalV2State(){
  const recovered=await storageV2?.recover?.(null);
  if(!recovered?.state)throw new Error('orders_v2_main_recovery_required');
  await captureEmbeddedWorkbook(recovered.state.notesSheet);
  session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),Number(recovered.appMetadata?.snapshotSeq||0));
  const previous=model.state;model.state=normalizeState(clone(recovered.state));domainRevisions?.reconcile(previous,model.state);
  return recovered;
}

async function recoverReadOnlyV2State(){
  const recovered=await storageV2?.recoverReadOnly?.();
  if(!recovered?.state)return null;
  session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),Number(recovered.appMetadata?.snapshotSeq||0));
  const previous=model.state;model.state=normalizeState(clone(recovered.state));domainRevisions?.reconcile(previous,model.state);
  return recovered;
}

function storageV2CloudOutboxActive(){return !!(storageV2?.primaryReady&&v2CloudStateCache?.base)}
function cloudPendingExists(){return !!(storageV2CloudOutboxActive()&&(session.storageV2CloudPending||v2CloudStateCache?.pending||v2CloudStateCache?.flight))}

function cacheStorageV2CloudState(state){v2CloudStateCache=state;session.storageV2CloudPending=!!(state?.pending||state?.flight);return state}
function settledStorageV2CloudState(seq,base,control=null){return {seq:Number(seq||0),base:base?clone(base):null,flight:null,control:control?clone(control):null,pending:false,pendingDeleteIntents:{},pendingGeneration:0,pendingMutationType:'autosave',pendingSurface:'unknown',afterFlightPending:false,afterFlightDeleteIntents:{},afterFlightGeneration:0,afterFlightMutationType:'autosave',afterFlightSurface:'unknown'}}
function resetStorageV2CloudState(seq,base){const current=Number(seq||0),ackSeq=Number(base?.ackSeq||0),pending=current>ackSeq;return {seq:current,base:base?clone(base):null,flight:null,control:null,pending,pendingDeleteIntents:{},pendingGeneration:pending?Number(session.localGeneration||0):0,pendingMutationType:'autosave',pendingSurface:pending?'epoch-transition':'unknown',afterFlightPending:false,afterFlightDeleteIntents:{},afterFlightGeneration:0,afterFlightMutationType:'autosave',afterFlightSurface:'unknown'}}
function acknowledgedStorageV2CloudState(prior,operationId,receipt,revision,state,control){
  const sent=prior?.flight?.operationId===operationId?prior.flight:null,ackSeq=Number(receipt?.ackSeq??sent?.endSeq??prior?.base?.ackSeq??0),seq=Math.max(ackSeq,Number(prior?.seq||0)),pending=seq>ackSeq,pendingDeleteIntents=pending&&sent?clone(prior?.afterFlightDeleteIntents||{}):{},pendingGeneration=pending&&sent?Number(prior?.afterFlightGeneration||0):0,pendingMutationType=pending&&sent?(prior?.afterFlightMutationType||'autosave'):'autosave',pendingSurface=pending&&sent?(prior?.afterFlightSurface||'unknown'):'unknown';
  return {...(prior||{}),seq,base:{...(prior?.base||{}),version:2,revision:Number(revision),state:clone(state),projection:'cloud',ackSeq},flight:null,control:control?clone(control):null,pending,pendingDeleteIntents,pendingGeneration,pendingMutationType,pendingSurface,afterFlightPending:false,afterFlightDeleteIntents:clone(pendingDeleteIntents),afterFlightGeneration:pendingGeneration,afterFlightMutationType:pendingMutationType,afterFlightSurface:pendingSurface}
}
async function refreshStorageV2CloudState(){
  if(!storageV2?.primaryReady){cacheStorageV2CloudState(null);return null}
  const state=await storageV2.cloudState({validateBase:value=>assertValidOrderCloudState(value,'Orders V2 cloud base')});cacheStorageV2CloudState(state);if(state?.control?.conflict)session.cloudConflictBlocked=true;return state
}
async function recoverCloudCursor(){
  const state=await refreshStorageV2CloudState();
  if(!state?.base)throw new Error('orders_v2_cloud_head_missing');
  session.lastCloudState=clone(state.base.state);
  session.cloudRevision=Number(state.base.revision||0);
  session.storageV2CloudPending=!!(state.pending||state.flight);
  session.cloudConflictBlocked=!!state.control?.conflict;
  session.cloudSaveRequested=!!(state.pending||state.flight)&&!session.cloudConflictBlocked;
  return state;
}
async function refreshStorageV2CloudStateAfterCommit(label,committedState){
  cacheStorageV2CloudState(committedState);
  try{return await refreshStorageV2CloudState()}catch(error){console.warn(`Storage V2 ${label} committed; cloud cache refresh deferred`,error);return committedState}
}

async function materializeStorageV2CloudFlight({throughSeq,snapshot}={}){
  const state=await refreshStorageV2CloudState();if(!state?.base)return null;
  if(state.flight)return state.flight;
  const flight=await storageV2.materializeFlight({operationId:createOperationId('orders-v2'),baseRevision:Number(state.base.revision),throughSeq,snapshot,project:value=>prepareCloudState(value),validateCloud:value=>assertValidOrderCloudState(value,'Orders V2 flight')});
  const fallback=flight?{...state,flight:clone(flight),pending:true,afterFlightPending:Number(state.seq||0)>Number(flight.endSeq||0)}:state;await refreshStorageV2CloudStateAfterCommit('flight materialization',fallback);return flight
}

async function acknowledgeStorageV2CloudFlight(operationId,revision,state,{currentState=model.state,control=null}={}){
  assertValidOrderCloudState(state,'Orders V2 ACK base');const prior=v2CloudStateCache,receipt=await storageV2.acknowledgeFlight(operationId,Number(revision),state,{validateBase:value=>assertValidOrderCloudState(value,'Orders V2 ACK base'),currentState,expectedSeq:Number.isSafeInteger(prior?.seq)?prior.seq:null,control,appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}}),fallback=acknowledgedStorageV2CloudState(prior,operationId,receipt,revision,state,control);return refreshStorageV2CloudStateAfterCommit('ACK',fallback)
}

async function rejectStorageV2CloudFlight(operationId,revision,state,{currentState,expectedSeq,control=null}={}){
  assertValidOrderCloudState(state,'Orders V2 rebase base');const prior=v2CloudStateCache,result=await storageV2.rejectFlight(operationId,Number(revision),state,{validateBase:value=>assertValidOrderCloudState(value,'Orders V2 rebase base'),currentState,expectedSeq,control,appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}}),fallback=result?.cloudState||{...(prior||{}),base:clone(result?.base||{...(prior?.base||{}),revision:Number(revision),state:clone(state)}),flight:null,control:result?.control?clone(result.control):control?clone(control):null,pending:!!prior?.pending,afterFlightPending:false,afterFlightDeleteIntents:clone(prior?.pendingDeleteIntents||{}),afterFlightGeneration:Number(prior?.pendingGeneration||0),afterFlightMutationType:prior?.pendingMutationType||'autosave',afterFlightSurface:prior?.pendingSurface||'unknown'};await refreshStorageV2CloudStateAfterCommit('confirmed flight rejection',fallback);return result
}

async function setStorageV2CloudControl(control={}){const result=await storageV2.setCloudControl(control),fallback=v2CloudStateCache?{...v2CloudStateCache,control:clone(result||control)}:v2CloudStateCache;await refreshStorageV2CloudStateAfterCommit('control update',fallback);return result}
async function clearStorageV2CloudControl(){const result=await storageV2.clearCloudControl(),fallback=v2CloudStateCache?{...v2CloudStateCache,control:null}:v2CloudStateCache;await refreshStorageV2CloudStateAfterCommit('control clear',fallback);return result}
async function replaceStorageV2AuthoritativeState(state=model.state,revision=session.cloudRevision){if(!storageV2?.primaryReady)return false;nextSnapshotSequence();const result=await storageV2.replaceAuthoritativeState(state,{appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}});await refreshStorageV2CloudStateAfterCommit('authoritative replacement',settledStorageV2CloudState(Number(result?.seq||0),null));return result}
async function replaceStorageV2CurrentState(state=model.state){const result=await storageV2.replaceCurrentState(state,{appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(session.cloudRevision||0),storageRole:'primary'}});await refreshStorageV2CloudStateAfterCommit('checkpoint replacement',v2CloudStateCache);return result}
async function adoptStorageV2CloudHead(revision,state=model.state,{expectedHead=null}={}){const cloud=prepareCloudState(state);assertValidOrderCloudState(cloud,'Orders V2 adopted cloud head');const result=await storageV2.adoptCloudHead(Number(revision),cloud,state,{expectedHead,validateBase:value=>assertValidOrderCloudState(value,'Orders V2 adopted cloud head'),appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}}),seq=Number(result?.seq??v2CloudStateCache?.seq??0),base={...(v2CloudStateCache?.base||{}),version:2,revision:Number(revision),state:clone(cloud),projection:'cloud',ackSeq:seq};const current=await refreshStorageV2CloudStateAfterCommit('cloud head adoption',settledStorageV2CloudState(seq,base));return {...result,seq:current?.seq??result.seq,revision:current?.base?.revision??result.revision,pending:!!current?.pending,control:current?.control??null}}
async function resetStorageV2CloudHead(revision,state=model.state){if(!storageV2?.primaryReady)return false;nextSnapshotSequence();const cloud=prepareCloudState(state);assertValidOrderCloudState(cloud,'Orders V2 reset cloud head');const result=await storageV2.resetCloudHead(Number(revision),cloud,state,{validateBase:value=>assertValidOrderCloudState(value,'Orders V2 reset cloud head'),appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}});session.cloudConflictBlocked=false;const ackSeq=Number(result?.ackSeq||0),base={version:2,owner:v2CloudStateCache?.base?.owner,epoch:result?.epoch,revision:Number(revision),state:clone(cloud),projection:'cloud',ackSeq};await refreshStorageV2CloudStateAfterCommit('cloud reset',resetStorageV2CloudState(Number(result?.seq||0),base));return result}

return {localSnapshot,idbSyncPut,idbSyncGet,idbSyncDelete,recoverLocalV2State,recoverReadOnlyV2State,cloudPendingExists,storageV2CloudOutboxActive,refreshStorageV2CloudState,recoverCloudCursor,materializeStorageV2CloudFlight,acknowledgeStorageV2CloudFlight,rejectStorageV2CloudFlight,setStorageV2CloudControl,clearStorageV2CloudControl,replaceStorageV2AuthoritativeState,replaceStorageV2CurrentState,adoptStorageV2CloudHead,resetStorageV2CloudHead,get storageV2CommitPromise(){return storageV2?.commitPromise||files.storageV2CommitPromise||Promise.resolve()}};
}

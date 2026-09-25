import {measureStorage,stringifyStorage,writeVerifiedStorage} from '../shared/storage-metrics.js';
import {beginMeasure} from '../shared/runtime-performance.js';
import {clone} from '../core/values.js';
import {createOperationId} from '../shared/cloud-sync.js';
import {assertValidCloudState} from '../state/validation.js';
import {BROWSER_STATE_KEY, BROWSER_STATE_IDB_KEY} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageBrowser({storageV2=null,legacyDrainActive=()=>false,legacyWriteAllowed=()=>true,legacyCloudPendingExists=()=>false,legacyCloudHeadVerifiedClean=()=>false,verifyLegacyCloudPending=async()=>null,model, session, files, normalizeState, prepareKupaCloudState=state=>state, idbPut, idbGet}){
let sequenceLoaded=false,v2CloudStateCache=null;
// Another primary tab may have saved while this tab was inactive.
globalThis.addEventListener?.('storage',event=>{if(event.key===BROWSER_STATE_KEY||event.key===null)sequenceLoaded=false});
function nextSnapshotSequence(){
  if(!sequenceLoaded){session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),storageV2?.cutoverActive?0:Number(loadBrowserStateSync()?.snapshotSeq||0));sequenceLoaded=true}
  return session.localSnapshotSeq=Number(session.localSnapshotSeq||0)+1;
}

function browserStateRecord(snapshot=model.state,revision=session.dbRevision,{normalized=false,owned=false,skipSequence=false}={}){if(!skipSequence)nextSnapshotSequence();return {schemaVersion:1,snapshotSeq:session.localSnapshotSeq,state:normalized?(owned?snapshot:measureStorage('checkpoint-clone',()=>clone(snapshot))):measureStorage('normalize',()=>normalizeState(snapshot)),revision:Number(revision||0),savedAt:new Date().toISOString()}}

function persistBrowserStateSync(record){if(storageV2?.cutoverActive||!legacyWriteAllowed())throw new Error('storage_v1_write_forbidden');try{const text=stringifyStorage('browser-snapshot',record);writeVerifiedStorage(localStorage,BROWSER_STATE_KEY,text);return true}catch(e){console.error('browser state localStorage',e);return false}}

function loadBrowserStateSync(){try{const raw=localStorage.getItem(BROWSER_STATE_KEY);return raw?JSON.parse(raw):null}catch(e){console.error('browser state local load',e);return null}}

function queueBrowserStateIdb(record){if(storageV2?.cutoverActive||!legacyWriteAllowed())throw new Error('storage_v1_write_forbidden');files.browserStatePendingRecord=clone(record);if(files.browserStateWritePromise)return files.browserStateWritePromise;files.browserStateWritePromise=(async()=>{while(files.browserStatePendingRecord){const next=files.browserStatePendingRecord;files.browserStatePendingRecord=null;await idbPut('sync',BROWSER_STATE_IDB_KEY,next)}})().catch(e=>console.error('browser state idb',e)).finally(()=>{files.browserStateWritePromise=null;if(files.browserStatePendingRecord)queueBrowserStateIdb(files.browserStatePendingRecord)});return files.browserStateWritePromise}

function persistImmediateBrowserSnapshot(snapshot=model.state,revision=session.dbRevision,options){const done=beginMeasure('kupa:local-snapshot');try{
  if(session.storageProtocolBlocked)throw new Error('storage_protocol_verification_required');
  nextSnapshotSequence();const appMetadata={snapshotSeq:session.localSnapshotSeq,revision:Number(revision||0)},drain=legacyDrainActive(),fast=drain?null:storageV2?.persist?.(snapshot,options,appMetadata);if(fast?.handled){files.storageV2CommitPromise=fast.committed;if(fast.seq&&v2CloudStateCache?.base){session.storageV2CloudPending=true;v2CloudStateCache={...v2CloudStateCache,seq:Math.max(Number(v2CloudStateCache.seq||0),Number(fast.seq)),pending:true}}return fast.emergencyDurable}
  if(storageV2?.cutoverActive||!legacyWriteAllowed())throw new Error('storage_v1_write_forbidden');
  const record=browserStateRecord(snapshot,revision,{...options,skipSequence:true});record.snapshotSeq=session.localSnapshotSeq;const ok=persistBrowserStateSync(record);queueBrowserStateIdb(record);return ok
}finally{done()}}

async function loadBrowserState(){if(storageV2?.cutoverActive){const recovered=await storageV2.recover(null);if(!recovered)throw new Error('storage_v2_cutover_recovery_required');session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),Number(recovered.appMetadata?.snapshotSeq||0));return {schemaVersion:2,v2Authoritative:true,snapshotSeq:session.localSnapshotSeq,state:recovered.state,revision:Number(recovered.appMetadata?.revision||0),savedAt:new Date().toISOString()}}const local=loadBrowserStateSync();let idb=null;try{idb=await idbGet('sync',BROWSER_STATE_IDB_KEY)}catch(e){console.error('browser state idb load',e)}const lt=Number(local?.snapshotSeq||0),it=Number(idb?.snapshotSeq||0);session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),lt,it);const chosen=!local||it>lt?idb:local,recovered=await storageV2?.recover?.(chosen?.state||null,{snapshotSeq:Math.max(lt,it),revision:Number(chosen?.revision||0)});if(recovered){session.localSnapshotSeq=Math.max(session.localSnapshotSeq,Number(recovered.appMetadata?.snapshotSeq||0));return {schemaVersion:2,snapshotSeq:session.localSnapshotSeq,state:recovered.state,revision:Number(recovered.appMetadata?.revision||chosen?.revision||0),savedAt:new Date().toISOString()}}if(chosen){persistBrowserStateSync(chosen);queueBrowserStateIdb(chosen)}return chosen||null}

async function loadBrowserStateReadOnly(){
  if(storageV2?.cutoverActive){const recovered=await storageV2.recoverReadOnly?.();if(!recovered)throw new Error('storage_v2_cutover_readonly_recovery_required');session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),Number(recovered.appMetadata?.snapshotSeq||0));return {schemaVersion:2,v2Authoritative:true,snapshotSeq:session.localSnapshotSeq,state:recovered.state,revision:Number(recovered.appMetadata?.revision||0),savedAt:new Date().toISOString()}}
  const local=loadBrowserStateSync();let idb=null;try{idb=await idbGet('sync',BROWSER_STATE_IDB_KEY)}catch(e){console.error('browser state idb load',e)}
  const lt=Number(local?.snapshotSeq||0),it=Number(idb?.snapshotSeq||0),chosen=!local||it>lt?idb:local,recovered=await storageV2?.recoverReadOnly?.();
  session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),lt,it,Number(recovered?.appMetadata?.snapshotSeq||0));
  if(recovered)return {schemaVersion:2,snapshotSeq:session.localSnapshotSeq,state:recovered.state,revision:Number(recovered.appMetadata?.revision||chosen?.revision||0),savedAt:new Date().toISOString()};
  return chosen||null;
}

async function requestPersistentBrowserStorage(){try{if(navigator.storage?.persist)await navigator.storage.persist()}catch(e){console.error('persistent storage request',e)}}

function storageV2CloudOutboxActive(){return !!(storageV2?.primaryReady&&v2CloudStateCache?.base&&(storageV2.cutoverActive||legacyCloudHeadVerifiedClean()&&!legacyCloudPendingExists()))}
function cacheStorageV2CloudState(state){v2CloudStateCache=state;session.storageV2CloudPending=!!(state?.pending||state?.flight);return state}
function settledStorageV2CloudState(seq,base,control=null){return {seq:Number(seq||0),base:base?clone(base):null,flight:null,control:control?clone(control):null,pending:false,pendingDeleteIntents:{},pendingGeneration:0,pendingMutationType:'autosave',pendingSurface:'unknown',afterFlightPending:false,afterFlightDeleteIntents:{},afterFlightGeneration:0,afterFlightMutationType:'autosave',afterFlightSurface:'unknown'}}
function resetStorageV2CloudState(seq,base){const current=Number(seq||0),ackSeq=Number(base?.ackSeq||0),pending=current>ackSeq;return {seq:current,base:base?clone(base):null,flight:null,control:null,pending,pendingDeleteIntents:{},pendingGeneration:pending?Number(session.localGeneration||0):0,pendingMutationType:'autosave',pendingSurface:pending?'epoch-transition':'unknown',afterFlightPending:false,afterFlightDeleteIntents:{},afterFlightGeneration:0,afterFlightMutationType:'autosave',afterFlightSurface:'unknown'}}
function acknowledgedStorageV2CloudState(prior,operationId,receipt,revision,state,control){const sent=prior?.flight?.operationId===operationId?prior.flight:null,ackSeq=Number(receipt?.ackSeq??sent?.endSeq??prior?.base?.ackSeq??0),seq=Math.max(ackSeq,Number(prior?.seq||0)),pending=seq>ackSeq,pendingDeleteIntents=pending&&sent?clone(prior?.afterFlightDeleteIntents||{}):{},pendingGeneration=pending&&sent?Number(prior?.afterFlightGeneration||0):0,pendingMutationType=pending&&sent?(prior?.afterFlightMutationType||'autosave'):'autosave',pendingSurface=pending&&sent?(prior?.afterFlightSurface||'unknown'):'unknown';return {...(prior||{}),seq,base:{...(prior?.base||{}),version:2,revision:Number(revision),state:clone(state),projection:'cloud',ackSeq},flight:null,control:control?clone(control):null,pending,pendingDeleteIntents,pendingGeneration,pendingMutationType,pendingSurface,afterFlightPending:false,afterFlightDeleteIntents:clone(pendingDeleteIntents),afterFlightGeneration:pendingGeneration,afterFlightMutationType:pendingMutationType,afterFlightSurface:pendingSurface}}
async function refreshStorageV2CloudState(){
  if(!storageV2?.primaryReady){cacheStorageV2CloudState(null);return null}
  if(!storageV2.cutoverActive)await verifyLegacyCloudPending();
  const state=await storageV2.cloudState({validateBase:value=>assertValidCloudState(value,'Kupa V2 cloud base')});cacheStorageV2CloudState(state);if(state?.control?.conflict)session.cloudConflictPending=true;return state
}
async function refreshStorageV2CloudStateAfterCommit(label,committedState){
  cacheStorageV2CloudState(committedState);
  try{return await refreshStorageV2CloudState()}catch(error){console.warn(`Storage V2 ${label} committed; cloud cache refresh deferred`,error);return committedState}
}
async function initializeStorageV2UploadLocalHead(emptyState,currentState=model.state){
  return initializeStorageV2BootstrapHead({intent:'upload-local',sourceOwner:'local',emptyState,currentState,revision:0});
}
async function initializeStorageV2BootstrapHead({intent,sourceOwner,operationId='',revision=0,emptyState=null,currentState=model.state,cloudState=null}={}){
  if(!storageV2?.initializeCloudHead||!storageV2?.initializeFirstCloudHead)throw new Error('kupa_v2_bootstrap_unavailable');
  if(await verifyLegacyCloudPending()||!legacyCloudHeadVerifiedClean()||legacyCloudPendingExists())throw new Error('kupa_v2_bootstrap_legacy_pending');
  const kind=String(intent||''),source=String(sourceOwner||'').trim(),target=normalizeState(clone(currentState)),metadata={snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary',bootstrapOperationId:String(operationId||'')};let recovered;
  if(['upload-local','upload-owner'].includes(kind)){
    if(!emptyState)throw new Error('kupa_v2_bootstrap_empty_state_required');const initial=normalizeState(clone(emptyState)),cloud=prepareKupaCloudState(initial,{normalized:true});assertValidCloudState(cloud,'Kupa V2 bootstrap base');
    recovered=await storageV2.initializeFirstCloudHead(initial,target,{sourceOwner:source,cloudState:cloud,validateBase:value=>assertValidCloudState(value,'Kupa V2 bootstrap base'),appMetadata:metadata});
  }else if(kind==='cloud-authoritative'){
    const cloud=clone(cloudState??prepareKupaCloudState(target,{normalized:true}));assertValidCloudState(cloud,'Kupa V2 bootstrap cloud head');
    recovered=await storageV2.initializeCloudHead(Number(revision),target,{sourceOwner:source,intent:kind,cloudState:cloud,validateBase:value=>assertValidCloudState(value,'Kupa V2 bootstrap cloud head'),appMetadata:metadata});
  }else throw new Error('kupa_v2_bootstrap_intent_invalid');
  const state=await storageV2.cloudState({validateBase:value=>assertValidCloudState(value,'Kupa V2 bootstrap base')});
  const upload=['upload-local','upload-owner'].includes(kind);
  if(!recovered||!state?.base||state.base.revision!==Number(revision)||state.flight||state.control||(upload?recovered.seq!==1||state.seq!==1||state.base.ackSeq!==0||!state.pending:state.pending||state.base.ackSeq!==state.seq))throw new Error('kupa_v2_bootstrap_verification_failed');
  return cacheStorageV2CloudState(state);
}

async function initializeStorageV2CloudCursor(revision){
  if(!storageV2?.primaryReady)return false;
  if(await verifyLegacyCloudPending())return false;
  if(!legacyCloudHeadVerifiedClean()||legacyCloudPendingExists())return false;
  await storageV2.flush();const base=await storageV2.captureCloudCursor(Number(revision||0),{project:state=>prepareKupaCloudState(state),validateBase:value=>assertValidCloudState(value,'Kupa V2 cloud base')});cacheStorageV2CloudState(settledStorageV2CloudState(base.ackSeq,base));return true
}
async function materializeStorageV2CloudFlight({throughSeq,snapshot}={}){
  const state=await refreshStorageV2CloudState();if(!state?.base)return null;if(state.flight)return state.flight;
  const flight=await storageV2.materializeFlight({operationId:createOperationId('kupa-v2'),baseRevision:Number(state.base.revision),throughSeq,snapshot,project:value=>prepareKupaCloudState(value),validateCloud:value=>assertValidCloudState(value,'Kupa V2 flight')});const fallback=flight?{...state,flight:clone(flight),pending:true,afterFlightPending:Number(state.seq||0)>Number(flight.endSeq||0)}:state;await refreshStorageV2CloudStateAfterCommit('flight materialization',fallback);return flight
}
async function acknowledgeStorageV2CloudFlight(operationId,revision,state,{currentState=model.state,control=null}={}){assertValidCloudState(state,'Kupa V2 ACK base');const prior=v2CloudStateCache,receipt=await storageV2.acknowledgeFlight(operationId,Number(revision),state,{validateBase:value=>assertValidCloudState(value,'Kupa V2 ACK base'),currentState,expectedSeq:Number.isSafeInteger(prior?.seq)?prior.seq:null,control,appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}}),fallback=acknowledgedStorageV2CloudState(prior,operationId,receipt,revision,state,control);return refreshStorageV2CloudStateAfterCommit('ACK',fallback)}
async function rejectStorageV2CloudFlight(operationId,revision,state,{currentState,expectedSeq,control=null}={}){assertValidCloudState(state,'Kupa V2 rebase base');const prior=v2CloudStateCache,result=await storageV2.rejectFlight(operationId,Number(revision),state,{validateBase:value=>assertValidCloudState(value,'Kupa V2 rebase base'),currentState,expectedSeq,control,appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}}),fallback=result?.cloudState||{...(prior||{}),base:clone(result?.base||{...(prior?.base||{}),revision:Number(revision),state:clone(state)}),flight:null,control:result?.control?clone(result.control):control?clone(control):null,pending:!!prior?.pending,afterFlightPending:false,afterFlightDeleteIntents:clone(prior?.pendingDeleteIntents||{}),afterFlightGeneration:Number(prior?.pendingGeneration||0),afterFlightMutationType:prior?.pendingMutationType||'autosave',afterFlightSurface:prior?.pendingSurface||'unknown'};await refreshStorageV2CloudStateAfterCommit('confirmed flight rejection',fallback);return result}
async function setStorageV2CloudControl(control={}){const result=await storageV2.setCloudControl(control),fallback=v2CloudStateCache?{...v2CloudStateCache,control:clone(result||control)}:v2CloudStateCache;await refreshStorageV2CloudStateAfterCommit('control update',fallback);return result}
async function clearStorageV2CloudControl(){const result=await storageV2.clearCloudControl(),fallback=v2CloudStateCache?{...v2CloudStateCache,control:null}:v2CloudStateCache;await refreshStorageV2CloudStateAfterCommit('control clear',fallback);return result}
async function replaceStorageV2AuthoritativeState(state=model.state,revision=session.dbRevision){if(!storageV2?.primaryReady)return false;nextSnapshotSequence();const result=await storageV2.replaceAuthoritativeState(state,{appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}});await refreshStorageV2CloudStateAfterCommit('authoritative replacement',settledStorageV2CloudState(Number(result?.seq||0),null));return result}
async function replaceStorageV2CurrentState(state=model.state){const result=await storageV2.replaceCurrentState(state,{appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(session.dbRevision||0),storageRole:'primary'}});await refreshStorageV2CloudStateAfterCommit('checkpoint replacement',v2CloudStateCache);return result}
async function queueStorageV2CloudNormalization(state=model.state,revision=session.dbRevision){
  const snapshot=clone(state),cloud=await refreshStorageV2CloudState(),expectedRevision=Number(revision);
  if(!cloud?.base||cloud.base.revision!==expectedRevision||cloud.pending||cloud.flight||cloud.control)throw new Error('kupa_v2_normalization_head_changed');
  const result=await storageV2.replaceLocalWithPending(snapshot,{boundaryId:`kupa-cloud-normalization:${expectedRevision}:${cloud.seq}`,expectedSeq:cloud.seq,expectedBaseRevision:expectedRevision,mutationType:'cloud-normalization',surface:'kupa.cloud-normalization',validateBase:value=>assertValidCloudState(value,'Kupa V2 normalization base')});
  await refreshStorageV2CloudStateAfterCommit('cloud normalization',v2CloudStateCache?{...v2CloudStateCache,seq:result.seq,pending:true}:cloud);
  return result;
}
async function adoptStorageV2CloudHead(revision,state=model.state,{cloudState=null}={}){const cloud=cloudState?clone(cloudState):prepareKupaCloudState(state);assertValidCloudState(cloud,'Kupa V2 adopted cloud head');const result=await storageV2.adoptCloudHead(Number(revision),cloud,state,{validateBase:value=>assertValidCloudState(value,'Kupa V2 adopted cloud head'),appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}}),seq=Number(result?.seq??v2CloudStateCache?.seq??0),base={...(v2CloudStateCache?.base||{}),version:2,revision:Number(revision),state:clone(cloud),projection:'cloud',ackSeq:seq};await refreshStorageV2CloudStateAfterCommit('cloud head adoption',settledStorageV2CloudState(seq,base));return result}
async function resetStorageV2CloudHead(revision,state=model.state){if(!storageV2?.primaryReady)return false;nextSnapshotSequence();const cloud=prepareKupaCloudState(state);assertValidCloudState(cloud,'Kupa V2 reset cloud head');const result=await storageV2.resetCloudHead(Number(revision),cloud,state,{validateBase:value=>assertValidCloudState(value,'Kupa V2 reset cloud head'),appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}});session.cloudConflictPending=false;const ackSeq=Number(result?.ackSeq||0),base={version:2,owner:v2CloudStateCache?.base?.owner,epoch:result?.epoch,revision:Number(revision),state:clone(cloud),projection:'cloud',ackSeq};await refreshStorageV2CloudStateAfterCommit('cloud reset',resetStorageV2CloudState(Number(result?.seq||0),base));return result}

return { browserStateRecord, persistBrowserStateSync, loadBrowserStateSync, queueBrowserStateIdb, persistImmediateBrowserSnapshot, loadBrowserState, loadBrowserStateReadOnly, requestPersistentBrowserStorage, storageV2CloudOutboxActive, refreshStorageV2CloudState, initializeStorageV2UploadLocalHead, initializeStorageV2BootstrapHead, initializeStorageV2CloudCursor, materializeStorageV2CloudFlight, acknowledgeStorageV2CloudFlight, rejectStorageV2CloudFlight, setStorageV2CloudControl, clearStorageV2CloudControl, replaceStorageV2AuthoritativeState, replaceStorageV2CurrentState, queueStorageV2CloudNormalization, adoptStorageV2CloudHead, resetStorageV2CloudHead, get storageV2CommitPromise(){return storageV2?.commitPromise||files.storageV2CommitPromise||Promise.resolve()} };
}

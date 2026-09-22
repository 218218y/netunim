import {measureStorage,stringifyStorage,writeVerifiedStorage} from '../shared/storage-metrics.js';
import {beginMeasure} from '../shared/runtime-performance.js';
import {createIndexedDbConnection} from '../shared/indexed-db-connection.js';
import {detachLegacyOutbox} from '../shared/spreadsheet-cutover.js';
import {clone} from '../core/values.js';
import {STORAGE_KEY, LOCAL_DB, LOCAL_STORE, LOCAL_STATE_KEY, CLOUD_PENDING_KEY} from '../state/constants.js';
import {acknowledgedGenerationMatches,compareOutboxFreshness,createOperationId,createOutboxRecord,migrateOutboxRecord,outboxRetryForGeneration} from '../shared/cloud-sync.js';
import {assertOrderEntityInvariants,assertValidOrderCloudState} from '../state/validation.js';

const LOCAL_SYNC_STORE='sync';
const ORDERS_OUTBOX_KEY='orders-outbox-v3';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageBrowser({storageV2=null,observeStorage=()=>{},externalWorkbooks=false,captureLegacyWorkbook=async()=>{},model, files, session, prepareState, prepareCloudState, normalizeState, domainRevisions}){
let sequenceLoaded=false,outboxHeadVerified=false,pendingCacheReadOk=true,v2CloudStateCache=null;
// Another primary tab may have saved while this tab was inactive.
function invalidateCloudPendingHead(){outboxHeadVerified=false}
globalThis.addEventListener?.('storage',event=>{if(event.key===STORAGE_KEY||event.key===null)sequenceLoaded=false;if(event.key===CLOUD_PENDING_KEY||event.key===null)invalidateCloudPendingHead()});
function nextSnapshotSequence(){
  if(!sequenceLoaded){session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),Number(loadLocal()?._meta?.localSnapshotSeq||0));sequenceLoaded=true}
  return session.localSnapshotSeq=Number(session.localSnapshotSeq||0)+1;
}

function loadLocal(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch(e){console.error('local load',e);return null}}

function localSnapshot(source=model.state,options){const done=beginMeasure('orders:local-snapshot');try{
  measureStorage('validate',()=>assertOrderEntityInvariants(source,{includeChecks:true,required:true}));nextSnapshotSequence();const appMetadata={snapshotSeq:session.localSnapshotSeq,revision:Number(session.cloudRevision||0)};
  const fast=storageV2?.persist?.(source,options,appMetadata);if(fast?.handled){files.storageV2CommitPromise=fast.committed;const mirrorOk=!fast.transitioning||persistStorageV2CompatibilitySnapshot(source,session.cloudRevision);if(fast.seq&&v2CloudStateCache?.base){session.storageV2CloudPending=true;v2CloudStateCache={...v2CloudStateCache,seq:Math.max(Number(v2CloudStateCache.seq||0),Number(fast.seq)),pending:true}}return mirrorOk}
  const payload=measureStorage('checkpoint-clone',()=>prepareState(source));payload._meta={...payload._meta,localSnapshotSeq:session.localSnapshotSeq};let localStorageOk=false;try{const text=stringifyStorage('browser-snapshot',payload);writeVerifiedStorage(localStorage,STORAGE_KEY,text);localStorageOk=true}catch(e){console.error('local snapshot',e)}queueBrowserStateSnapshot(payload);if(!fast?.transitioning)try{if(storageV2)storageV2.afterLegacy(payload,options,appMetadata);else observeStorage(payload,options)}catch(error){console.error('storage V2 observation',error)}return localStorageOk
}finally{done()}}

const openLocalStateDb=createIndexedDbConnection(LOCAL_DB,2,db=>{if(!db.objectStoreNames.contains(LOCAL_STORE))db.createObjectStore(LOCAL_STORE);if(!db.objectStoreNames.contains(LOCAL_SYNC_STORE))db.createObjectStore(LOCAL_SYNC_STORE)});

async function idbSyncPut(key,value){const db=await openLocalStateDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(LOCAL_SYNC_STORE,'readwrite');tx.objectStore(LOCAL_SYNC_STORE).put(value,key);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB sync write aborted'))})}
async function idbSyncGet(key){const db=await openLocalStateDb();return await new Promise((resolve,reject)=>{const r=db.transaction(LOCAL_SYNC_STORE,'readonly').objectStore(LOCAL_SYNC_STORE).get(key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error)})}
async function idbSyncDelete(key){const db=await openLocalStateDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(LOCAL_SYNC_STORE,'readwrite');tx.objectStore(LOCAL_SYNC_STORE).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB sync delete aborted'))})}

async function persistBrowserStateSnapshot(payload){const db=await openLocalStateDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(LOCAL_STORE,'readwrite');tx.objectStore(LOCAL_STORE).put({payload,savedAt:Date.parse(payload?._meta?.savedAt||'')||Date.now()},LOCAL_STATE_KEY);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB write aborted'))})}

function queueBrowserStateSnapshot(payload){files.browserStatePendingPayload=clone(payload);if(files.browserStateWritePromise)return files.browserStateWritePromise;files.browserStateWritePromise=(async()=>{while(files.browserStatePendingPayload){const next=files.browserStatePendingPayload;files.browserStatePendingPayload=null;await persistBrowserStateSnapshot(next)}})().catch(e=>{console.error('browser state mirror',e)}).finally(()=>{files.browserStateWritePromise=null;if(files.browserStatePendingPayload)queueBrowserStateSnapshot(files.browserStatePendingPayload)});return files.browserStateWritePromise}

async function loadBrowserStateSnapshot(){try{const db=await openLocalStateDb();return await new Promise((resolve,reject)=>{const r=db.transaction(LOCAL_STORE).objectStore(LOCAL_STORE).get(LOCAL_STATE_KEY);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}catch(e){console.error('browser state load',e);return null}}

async function restoreBrowserStateFallback(){
  const record=await loadBrowserStateSnapshot(),local=loadLocal(),localSeq=Number(local?._meta?.localSnapshotSeq||0),idbSeq=Number(record?.payload?._meta?.localSnapshotSeq||0),legacy=!local||idbSeq>localSeq?record?.payload:local;
  session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),localSeq,idbSeq);const recovered=await storageV2?.recover?.(legacy,{snapshotSeq:Math.max(localSeq,idbSeq),revision:Number(session.cloudRevision||0)}),selected=recovered?.state||legacy;
  if(!selected)return false;session.localSnapshotSeq=Math.max(session.localSnapshotSeq,Number(recovered?.appMetadata?.snapshotSeq||0));await captureLegacyWorkbook(selected.notesSheet);const previous=model.state;model.state=normalizeState(clone(selected));domainRevisions?.reconcile(previous,model.state);
  if(!recovered&&record?.payload&&(!local||idbSeq>localSeq))try{localStorage.setItem(STORAGE_KEY,JSON.stringify(record.payload))}catch(e){console.error('restore localStorage from IndexedDB',e)}
  return !!recovered||!!(record?.payload&&(!local||idbSeq>localSeq));
}

function readPendingCache(){try{const value=JSON.parse(localStorage.getItem(CLOUD_PENDING_KEY)||'null');pendingCacheReadOk=true;return value}catch(e){pendingCacheReadOk=false;console.error('cloud pending cache load',e);return null}}
function writePendingCache(record){try{const text=stringifyStorage('pending',record);writeVerifiedStorage(localStorage,CLOUD_PENDING_KEY,text);return true}catch(e){console.error('cloud pending cache',e);return false}}
function normalizeDeleteIntents(value){const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();if(clean.length)out[key]=clean}return out}
function mergeDeleteIntents(...values){const out={};for(const value of values){for(const [key,ids] of Object.entries(normalizeDeleteIntents(value))){out[key]=[...new Set([...(out[key]||[]),...ids])].sort()}}return out}
function migrateOrdersOutboxRecord(value,migration){const record=migrateOutboxRecord(value,migration);if(record)record.deleteIntents=normalizeDeleteIntents(value?.deleteIntents);return record}

function markCloudPending(snapshot=prepareCloudState(),message='',progress=null){
  assertValidOrderCloudState(snapshot,'Orders outbox snapshot');
  const diskCache=outboxHeadVerified?session.ordersOutboxCached:readPendingCache(),cached=compareOutboxFreshness(session.ordersOutboxCached,diskCache)>0?session.ordersOutboxCached:diskCache,canonical=clone(snapshot),generation=Math.max(Number(session.localGeneration||0),Number(cached?.generation||0),1),sameGeneration=!!cached&&Number(cached.generation||0)===generation,record=createOutboxRecord({
    domain:'orders',documentName:'suppliers',operationId:sameGeneration?(cached.operationId||cached.id):undefined,
    generation,mutationSeq:Math.max(Number(cached?.mutationSeq||cached?.commitSeq||cached?.generation||0)+1,generation),
    baseRevision:progress?.baseRevision??(cached?.baseRevision??session.cloudRevision??0),
    baseState:progress?.baseState??(cached?.baseState??session.lastCloudState??canonical),snapshot:canonical,
    createdAt:cached?.createdAt||cached?.updatedAt,updatedAt:new Date().toISOString(),
    conflict:progress?.conflict===undefined?(cached?.conflict||null):progress.conflict,retry:outboxRetryForGeneration(cached,{sameGeneration,retry:progress?.retry}),
    mutationType:progress?.mutationType||cached?.mutationType||'autosave',surface:progress?.surface||cached?.surface||'orders',restoreGroupId:progress?.restoreGroupId||cached?.restoreGroupId||null,
  });
  record.deleteIntents=mergeDeleteIntents(cached?.deleteIntents,progress?.deleteIntents);
  const cacheOk=writePendingCache(record);session.ordersOutboxCached=record;outboxHeadVerified=false;
  const previous=session.ordersOutboxCommitPromise||Promise.resolve();
  const outboxDone=beginMeasure('orders:outbox-durable');
  const commit=previous.catch(()=>{}).then(async()=>{
    try{await idbSyncPut(ORDERS_OUTBOX_KEY,record);session.cloudDurabilityDegraded=false;return {record,durable:true}}
    catch(error){console.error('orders outbox IndexedDB',error);session.cloudDurabilityDegraded=true;if(!cacheOk)throw new Error('orders_outbox_persistence_failed',{cause:error});return {record,durable:true,store:'localStorage'}}
  });
  session.ordersOutboxCommitPromise=commit;
  commit.then(result=>{if(session.ordersOutboxCommitPromise===commit)outboxHeadVerified=cacheOk&&result?.store!=='localStorage'},()=>{});commit.then(outboxDone,()=>{});
  return cacheOk;
}

function legacyCloudPendingExists(){return outboxHeadVerified?!!session.ordersOutboxCached:!!(session.ordersOutboxCached||localStorage.getItem(CLOUD_PENDING_KEY))}
function legacyCloudOutboxVerifiedClean(){return outboxHeadVerified&&!session.ordersOutboxCached}
function storageV2CloudOutboxActive(){return !!(storageV2?.primaryReady&&v2CloudStateCache?.base&&legacyCloudOutboxVerifiedClean())}
function cloudPendingExists(){return legacyCloudPendingExists()||!!(storageV2CloudOutboxActive()&&(session.storageV2CloudPending||v2CloudStateCache?.pending||v2CloudStateCache?.flight))}

async function getCloudPending(){
  const observedCommit=session.ordersOutboxCommitPromise;await observedCommit;
  if(session.ordersOutboxCommitPromise!==observedCommit)return getCloudPending();
  if(outboxHeadVerified)return session.ordersOutboxCached||null;
  const fallbackSnapshot=prepareCloudState(loadLocal()||model.state),migration={domain:'orders',documentName:'suppliers',baseRevision:session.cloudRevision||0,baseState:session.lastCloudState||fallbackSnapshot,snapshot:fallbackSnapshot,generation:Math.max(1,Number(session.localGeneration||0))};
  const local=migrateOrdersOutboxRecord(readPendingCache(),migration);let durable=null,durableReadOk=false;
  try{durable=migrateOrdersOutboxRecord(await idbSyncGet(ORDERS_OUTBOX_KEY),migration);durableReadOk=true}catch(e){console.error('orders outbox load',e)}
  if(session.ordersOutboxCommitPromise!==observedCommit)return getCloudPending();
  let chosen=!local?durable:!durable?local:(compareOutboxFreshness(local,durable)>=0?local:durable);
  if(!chosen){session.ordersOutboxCached=null;outboxHeadVerified=pendingCacheReadOk&&durableReadOk;return null}
  if(externalWorkbooks)chosen=await detachLegacyOutbox(chosen,captureLegacyWorkbook);
  session.ordersOutboxCached=chosen;session.localGeneration=Math.max(Number(session.localGeneration||0),Number(chosen.generation||0));const cacheOk=writePendingCache(chosen);let durableOk=false;
  try{await idbSyncPut(ORDERS_OUTBOX_KEY,chosen);durableOk=true;session.cloudDurabilityDegraded=false}catch(e){session.cloudDurabilityDegraded=true;console.error('orders outbox repair',e)}
  if(session.ordersOutboxCommitPromise!==observedCommit)return getCloudPending();
  outboxHeadVerified=cacheOk&&durableOk;return chosen;
}

async function clearCloudPending(acknowledgedGeneration){
  const current=await getCloudPending();if(!current)return true;
  if(!acknowledgedGenerationMatches(current,acknowledgedGeneration)||Number(session.ordersOutboxCached?.generation||0)>Number(current.generation)||Number(session.ordersOutboxCached?.mutationSeq||0)>Number(current.mutationSeq||0))return false;
  // Serialize deletion with staging: a mutation during deletion commits after it.
  const clearing=(session.ordersOutboxCommitPromise||Promise.resolve()).then(async()=>{
    try{await idbSyncDelete(ORDERS_OUTBOX_KEY);return true}catch(e){console.error('orders outbox clear',e);session.cloudDurabilityDegraded=true;return false}
  });
  session.ordersOutboxCommitPromise=clearing;
  if(!await clearing)return false;
  if(session.ordersOutboxCommitPromise!==clearing||!acknowledgedGenerationMatches(session.ordersOutboxCached,acknowledgedGeneration))return false;
  try{localStorage.removeItem(CLOUD_PENDING_KEY)}catch(e){console.error('orders outbox cache clear',e);session.cloudDurabilityDegraded=true;return false}
  session.ordersOutboxCached=null;outboxHeadVerified=true;session.cloudDurabilityDegraded=false;return true;
}

function loadCloudPendingState(){try{const pending=readPendingCache();if(!pending)return null;if(pending?.pending===true)return loadLocal();return pending?.snapshot&&typeof pending.snapshot==='object'?pending.snapshot:pending}catch(e){console.error('cloud pending load',e);return loadLocal()}}

function cacheStorageV2CloudState(state){v2CloudStateCache=state;session.storageV2CloudPending=!!(state?.pending||state?.flight);return state}
function settledStorageV2CloudState(seq,base,control=null){return {seq:Number(seq||0),base:base?clone(base):null,flight:null,control:control?clone(control):null,pending:false,pendingDeleteIntents:{},pendingGeneration:0,pendingMutationType:'autosave',pendingSurface:'unknown',afterFlightPending:false,afterFlightDeleteIntents:{},afterFlightGeneration:0,afterFlightMutationType:'autosave',afterFlightSurface:'unknown'}}
function resetStorageV2CloudState(seq,base){const current=Number(seq||0),ackSeq=Number(base?.ackSeq||0),pending=current>ackSeq;return {seq:current,base:base?clone(base):null,flight:null,control:null,pending,pendingDeleteIntents:{},pendingGeneration:pending?Number(session.localGeneration||0):0,pendingMutationType:'autosave',pendingSurface:pending?'epoch-transition':'unknown',afterFlightPending:false,afterFlightDeleteIntents:{},afterFlightGeneration:0,afterFlightMutationType:'autosave',afterFlightSurface:'unknown'}}
function acknowledgedStorageV2CloudState(prior,operationId,receipt,revision,state,control){
  const sent=prior?.flight?.operationId===operationId?prior.flight:null,ackSeq=Number(receipt?.ackSeq??sent?.endSeq??prior?.base?.ackSeq??0),seq=Math.max(ackSeq,Number(prior?.seq||0)),pending=seq>ackSeq,pendingDeleteIntents=pending&&sent?clone(prior?.afterFlightDeleteIntents||{}):{},pendingGeneration=pending&&sent?Number(prior?.afterFlightGeneration||0):0,pendingMutationType=pending&&sent?(prior?.afterFlightMutationType||'autosave'):'autosave',pendingSurface=pending&&sent?(prior?.afterFlightSurface||'unknown'):'unknown';
  return {...(prior||{}),seq,base:{...(prior?.base||{}),version:2,revision:Number(revision),state:clone(state),projection:'cloud',ackSeq},flight:null,control:control?clone(control):null,pending,pendingDeleteIntents,pendingGeneration,pendingMutationType,pendingSurface,afterFlightPending:false,afterFlightDeleteIntents:clone(pendingDeleteIntents),afterFlightGeneration:pendingGeneration,afterFlightMutationType:pendingMutationType,afterFlightSurface:pendingSurface}
}
async function refreshStorageV2CloudState(){
  if(!storageV2?.primaryReady){cacheStorageV2CloudState(null);return null}
  await getCloudPending();
  const state=await storageV2.cloudState({validateBase:value=>assertValidOrderCloudState(value,'Orders V2 cloud base')});cacheStorageV2CloudState(state);if(state?.control?.conflict)session.cloudConflictBlocked=true;return state
}
async function refreshStorageV2CloudStateAfterCommit(label,committedState){
  cacheStorageV2CloudState(committedState);
  try{return await refreshStorageV2CloudState()}catch(error){console.warn(`Storage V2 ${label} committed; cloud cache refresh deferred`,error);return committedState}
}

async function initializeStorageV2CloudCursor(revision){
  if(!storageV2?.primaryReady)return false;
  if(await getCloudPending())return false;
  if(!legacyCloudOutboxVerifiedClean())return false;
  await storageV2.flush();
  const base=await storageV2.captureCloudCursor(Number(revision||0),{project:state=>prepareCloudState(state),validateBase:value=>assertValidOrderCloudState(value,'Orders V2 cloud base')});
  cacheStorageV2CloudState(settledStorageV2CloudState(base.ackSeq,base));return true
}

async function materializeStorageV2CloudFlight({throughSeq,snapshot}={}){
  const state=await refreshStorageV2CloudState();if(!state?.base)return null;
  if(state.flight)return state.flight;
  const flight=await storageV2.materializeFlight({operationId:createOperationId('orders-v2'),baseRevision:Number(state.base.revision),throughSeq,snapshot,project:value=>prepareCloudState(value),validateCloud:value=>assertValidOrderCloudState(value,'Orders V2 flight')});
  const fallback=flight?{...state,flight:clone(flight),pending:true,afterFlightPending:Number(state.seq||0)>Number(flight.endSeq||0)}:state;await refreshStorageV2CloudStateAfterCommit('flight materialization',fallback);return flight
}

async function acknowledgeStorageV2CloudFlight(operationId,revision,state,{currentState=model.state,control=null}={}){
  assertValidOrderCloudState(state,'Orders V2 ACK base');const prior=v2CloudStateCache,receipt=await storageV2.acknowledgeFlight(operationId,Number(revision),state,{validateBase:value=>assertValidOrderCloudState(value,'Orders V2 ACK base'),currentState,control,appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}}),fallback=acknowledgedStorageV2CloudState(prior,operationId,receipt,revision,state,control);return refreshStorageV2CloudStateAfterCommit('ACK',fallback)
}

async function rejectStorageV2CloudFlight(operationId,revision,state,{control=null}={}){
  assertValidOrderCloudState(state,'Orders V2 rebase base');const prior=v2CloudStateCache,result=await storageV2.rejectFlight(operationId,Number(revision),state,{validateBase:value=>assertValidOrderCloudState(value,'Orders V2 rebase base'),control}),fallback={...(prior||{}),base:clone(result?.base||{...(prior?.base||{}),revision:Number(revision),state:clone(state)}),flight:null,control:result?.control?clone(result.control):control?clone(control):null,pending:!!prior?.pending,afterFlightPending:false,afterFlightDeleteIntents:clone(prior?.pendingDeleteIntents||{}),afterFlightGeneration:Number(prior?.pendingGeneration||0),afterFlightMutationType:prior?.pendingMutationType||'autosave',afterFlightSurface:prior?.pendingSurface||'unknown'};await refreshStorageV2CloudStateAfterCommit('confirmed flight rejection',fallback);return result
}

async function setStorageV2CloudControl(control={}){const result=await storageV2.setCloudControl(control),fallback=v2CloudStateCache?{...v2CloudStateCache,control:clone(result||control)}:v2CloudStateCache;await refreshStorageV2CloudStateAfterCommit('control update',fallback);return result}
async function clearStorageV2CloudControl(){const result=await storageV2.clearCloudControl(),fallback=v2CloudStateCache?{...v2CloudStateCache,control:null}:v2CloudStateCache;await refreshStorageV2CloudStateAfterCommit('control clear',fallback);return result}
function persistStorageV2CompatibilitySnapshot(state,revision){const payload=measureStorage('checkpoint-clone',()=>prepareState(state));payload._meta={...payload._meta,localSnapshotSeq:Number(session.localSnapshotSeq||0)};let ok=false;try{const text=stringifyStorage('browser-snapshot',payload);writeVerifiedStorage(localStorage,STORAGE_KEY,text);ok=true}catch(error){console.error('V2 compatibility snapshot',error)}queueBrowserStateSnapshot(payload);return ok}
async function replaceStorageV2AuthoritativeState(state=model.state,revision=session.cloudRevision){if(!storageV2?.primaryReady)return false;nextSnapshotSequence();const result=await storageV2.replaceAuthoritativeState(state,{appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}});if(!persistStorageV2CompatibilitySnapshot(model.state,revision))console.warn('Storage V2 authoritative state is durable; legacy compatibility snapshot could not be refreshed');await refreshStorageV2CloudStateAfterCommit('authoritative replacement',settledStorageV2CloudState(Number(result?.seq||0),null));return result}
async function replaceStorageV2CurrentState(state=model.state){const result=await storageV2.replaceCurrentState(state,{appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(session.cloudRevision||0),storageRole:'primary'}});await refreshStorageV2CloudStateAfterCommit('checkpoint replacement',v2CloudStateCache);return result}
async function adoptStorageV2CloudHead(revision,state=model.state){const cloud=prepareCloudState(state);assertValidOrderCloudState(cloud,'Orders V2 adopted cloud head');const result=await storageV2.adoptCloudHead(Number(revision),cloud,state,{validateBase:value=>assertValidOrderCloudState(value,'Orders V2 adopted cloud head'),appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}}),seq=Number(result?.seq??v2CloudStateCache?.seq??0),base={...(v2CloudStateCache?.base||{}),version:2,revision:Number(revision),state:clone(cloud),projection:'cloud',ackSeq:seq};await refreshStorageV2CloudStateAfterCommit('cloud head adoption',settledStorageV2CloudState(seq,base));return result}
async function resetStorageV2CloudHead(revision,state=model.state){if(!storageV2?.primaryReady)return false;nextSnapshotSequence();const cloud=prepareCloudState(state);assertValidOrderCloudState(cloud,'Orders V2 reset cloud head');const result=await storageV2.resetCloudHead(Number(revision),cloud,state,{validateBase:value=>assertValidOrderCloudState(value,'Orders V2 reset cloud head'),appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}});if(!persistStorageV2CompatibilitySnapshot(model.state,revision))console.warn('Storage V2 cloud reset is durable; legacy compatibility snapshot could not be refreshed');session.cloudConflictBlocked=false;const ackSeq=Number(result?.ackSeq||0),base={version:2,owner:v2CloudStateCache?.base?.owner,epoch:result?.epoch,revision:Number(revision),state:clone(cloud),projection:'cloud',ackSeq};await refreshStorageV2CloudStateAfterCommit('cloud reset',resetStorageV2CloudState(Number(result?.seq||0),base));return result}

return { loadLocal, localSnapshot, openLocalStateDb, idbSyncPut, idbSyncGet, idbSyncDelete, persistBrowserStateSnapshot, queueBrowserStateSnapshot, loadBrowserStateSnapshot, restoreBrowserStateFallback, markCloudPending, getCloudPending, cloudPendingExists, legacyCloudPendingExists, clearCloudPending, loadCloudPendingState, invalidateCloudPendingHead, storageV2CloudOutboxActive, refreshStorageV2CloudState, initializeStorageV2CloudCursor, materializeStorageV2CloudFlight, acknowledgeStorageV2CloudFlight, rejectStorageV2CloudFlight, setStorageV2CloudControl, clearStorageV2CloudControl, replaceStorageV2AuthoritativeState, replaceStorageV2CurrentState, adoptStorageV2CloudHead, resetStorageV2CloudHead, get storageV2CommitPromise(){return storageV2?.commitPromise||files.storageV2CommitPromise||Promise.resolve()} };
}

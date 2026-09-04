import {clone} from '../core/values.js';
import {STORAGE_KEY, LOCAL_DB, LOCAL_STORE, LOCAL_STATE_KEY, CLOUD_PENDING_KEY} from '../state/constants.js';
import {acknowledgedGenerationMatches,compareOutboxFreshness,createOutboxRecord,migrateOutboxRecord,outboxRetryForGeneration} from '../shared/cloud-sync.js';
import {assertOrderEntityInvariants,assertValidOrderCloudState} from '../state/validation.js';

const LOCAL_SYNC_STORE='sync';
const ORDERS_OUTBOX_KEY='orders-outbox-v3';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageBrowser({model, files, session, prepareState, prepareCloudState, normalizeState}){
function loadLocal(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch(e){console.error('local load',e);return null}}

function localSnapshot(source=model.state){assertOrderEntityInvariants(source,{includeChecks:true,required:true});const payload=prepareState(source);let localStorageOk=false;try{const text=JSON.stringify(payload);localStorage.setItem(STORAGE_KEY,text);if(localStorage.getItem(STORAGE_KEY)!==text)throw new Error('local snapshot verification failed');localStorageOk=true}catch(e){console.error('local snapshot',e)}queueBrowserStateSnapshot(payload);return localStorageOk}

async function openLocalStateDb(){return await new Promise((resolve,reject)=>{const r=indexedDB.open(LOCAL_DB,2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(LOCAL_STORE))r.result.createObjectStore(LOCAL_STORE);if(!r.result.objectStoreNames.contains(LOCAL_SYNC_STORE))r.result.createObjectStore(LOCAL_SYNC_STORE)};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}

async function idbSyncPut(key,value){const db=await openLocalStateDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(LOCAL_SYNC_STORE,'readwrite');tx.objectStore(LOCAL_SYNC_STORE).put(clone(value),key);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB sync write aborted'))})}finally{db.close()}}
async function idbSyncGet(key){const db=await openLocalStateDb();try{return await new Promise((resolve,reject)=>{const r=db.transaction(LOCAL_SYNC_STORE,'readonly').objectStore(LOCAL_SYNC_STORE).get(key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error)})}finally{db.close()}}
async function idbSyncDelete(key){const db=await openLocalStateDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(LOCAL_SYNC_STORE,'readwrite');tx.objectStore(LOCAL_SYNC_STORE).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB sync delete aborted'))})}finally{db.close()}}

async function persistBrowserStateSnapshot(payload){const db=await openLocalStateDb();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(LOCAL_STORE,'readwrite');tx.objectStore(LOCAL_STORE).put({payload:clone(payload),savedAt:Date.parse(payload?._meta?.savedAt||'')||Date.now()},LOCAL_STATE_KEY);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB write aborted'))})}finally{db.close()}}

function queueBrowserStateSnapshot(payload){files.browserStatePendingPayload=clone(payload);if(files.browserStateWritePromise)return files.browserStateWritePromise;files.browserStateWritePromise=(async()=>{while(files.browserStatePendingPayload){const next=files.browserStatePendingPayload;files.browserStatePendingPayload=null;await persistBrowserStateSnapshot(next)}})().catch(e=>{console.error('browser state mirror',e)}).finally(()=>{files.browserStateWritePromise=null;if(files.browserStatePendingPayload)queueBrowserStateSnapshot(files.browserStatePendingPayload)});return files.browserStateWritePromise}

async function loadBrowserStateSnapshot(){try{const db=await openLocalStateDb();try{return await new Promise((resolve,reject)=>{const r=db.transaction(LOCAL_STORE).objectStore(LOCAL_STORE).get(LOCAL_STATE_KEY);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}finally{db.close()}}catch(e){console.error('browser state load',e);return null}}

async function restoreBrowserStateFallback(){const record=await loadBrowserStateSnapshot();if(!record?.payload)return false;const local=loadLocal(),localTime=Date.parse(local?._meta?.savedAt||'')||0,idbTime=Number(record.savedAt||Date.parse(record.payload?._meta?.savedAt||'')||0);if(!local||(localTime>0&&idbTime>localTime)){model.state=normalizeState(clone(record.payload));try{localStorage.setItem(STORAGE_KEY,JSON.stringify(record.payload))}catch(e){console.error('restore localStorage from IndexedDB',e)}return true}return false}

function readPendingCache(){try{return JSON.parse(localStorage.getItem(CLOUD_PENDING_KEY)||'null')}catch(e){console.error('cloud pending cache load',e);return null}}
function writePendingCache(record){try{const text=JSON.stringify(record);localStorage.setItem(CLOUD_PENDING_KEY,text);if(localStorage.getItem(CLOUD_PENDING_KEY)!==text)throw new Error('pending cache verification failed');return true}catch(e){console.error('cloud pending cache',e);return false}}
function normalizeDeleteIntents(value){const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();if(clean.length)out[key]=clean}return out}
function mergeDeleteIntents(...values){const out={};for(const value of values){for(const [key,ids] of Object.entries(normalizeDeleteIntents(value))){out[key]=[...new Set([...(out[key]||[]),...ids])].sort()}}return out}
function migrateOrdersOutboxRecord(value,migration){const record=migrateOutboxRecord(value,migration);if(record)record.deleteIntents=normalizeDeleteIntents(value?.deleteIntents);return record}

function markCloudPending(snapshot=prepareCloudState(),message='',progress=null){
  assertValidOrderCloudState(snapshot,'Orders outbox snapshot');
  const cached=readPendingCache(),canonical=clone(snapshot),generation=Math.max(Number(session.localGeneration||0),Number(cached?.generation||0),1),sameGeneration=!!cached&&Number(cached.generation||0)===generation,advanced=Number(session.cloudRevision||0)>Number(cached?.baseRevision||0),record=createOutboxRecord({
    domain:'orders',documentName:'suppliers',operationId:sameGeneration?(cached.operationId||cached.id):undefined,
    generation,mutationSeq:Math.max(Number(cached?.mutationSeq||cached?.commitSeq||cached?.generation||0)+1,generation),
    baseRevision:progress?.baseRevision??(advanced?session.cloudRevision:cached?.baseRevision??session.cloudRevision??0),
    baseState:progress?.baseState??(advanced?session.lastCloudState:cached?.baseState??session.lastCloudState??canonical),snapshot:canonical,
    createdAt:cached?.createdAt||cached?.updatedAt,updatedAt:new Date().toISOString(),
    conflict:progress?.conflict===undefined?(cached?.conflict||null):progress.conflict,retry:outboxRetryForGeneration(cached,{sameGeneration,retry:progress?.retry}),
    mutationType:progress?.mutationType||cached?.mutationType||'autosave',surface:progress?.surface||cached?.surface||'orders',restoreGroupId:progress?.restoreGroupId||cached?.restoreGroupId||null,
  });
  record.deleteIntents=mergeDeleteIntents(cached?.deleteIntents,progress?.deleteIntents);
  const cacheOk=writePendingCache(record);session.ordersOutboxCached=record;
  const previous=session.ordersOutboxCommitPromise||Promise.resolve();
  session.ordersOutboxCommitPromise=previous.catch(()=>{}).then(async()=>{
    try{await idbSyncPut(ORDERS_OUTBOX_KEY,record);session.cloudDurabilityDegraded=false;return {record,durable:true}}
    catch(error){console.error('orders outbox IndexedDB',error);session.cloudDurabilityDegraded=true;if(!cacheOk)throw new Error('orders_outbox_persistence_failed',{cause:error});return {record,durable:false}}
  });
  return cacheOk;
}

function cloudPendingExists(){return !!(session.ordersOutboxCached||localStorage.getItem(CLOUD_PENDING_KEY))}

async function getCloudPending(){
  try{await session.ordersOutboxCommitPromise}catch(e){console.error('orders outbox commit',e)}
  const fallbackSnapshot=prepareCloudState(loadLocal()||model.state),migration={domain:'orders',documentName:'suppliers',baseRevision:session.cloudRevision||0,baseState:session.lastCloudState||fallbackSnapshot,snapshot:fallbackSnapshot,generation:Math.max(1,Number(session.localGeneration||0))};
  const local=migrateOrdersOutboxRecord(readPendingCache(),migration);let durable=null;
  try{durable=migrateOrdersOutboxRecord(await idbSyncGet(ORDERS_OUTBOX_KEY),migration)}catch(e){console.error('orders outbox load',e)}
  const chosen=!local?durable:!durable?local:(compareOutboxFreshness(local,durable)>=0?local:durable);
  if(!chosen){session.ordersOutboxCached=null;return null}
  session.ordersOutboxCached=chosen;session.localGeneration=Math.max(Number(session.localGeneration||0),Number(chosen.generation||0));writePendingCache(chosen);
  try{await idbSyncPut(ORDERS_OUTBOX_KEY,chosen);session.cloudDurabilityDegraded=false}catch(e){session.cloudDurabilityDegraded=true;console.error('orders outbox repair',e)}
  return chosen;
}

async function clearCloudPending(acknowledgedGeneration){const current=await getCloudPending();if(!current)return true;if(!acknowledgedGenerationMatches(current,acknowledgedGeneration))return false;try{await idbSyncDelete(ORDERS_OUTBOX_KEY)}catch(e){console.error('orders outbox clear',e);session.cloudDurabilityDegraded=true;return false}try{localStorage.removeItem(CLOUD_PENDING_KEY)}catch(e){console.error('orders outbox cache clear',e);session.cloudDurabilityDegraded=true;return false}session.ordersOutboxCached=null;session.cloudDurabilityDegraded=false;return true}

function loadCloudPendingState(){try{const pending=readPendingCache();if(!pending)return null;if(pending?.pending===true)return loadLocal();return pending?.snapshot&&typeof pending.snapshot==='object'?pending.snapshot:pending}catch(e){console.error('cloud pending load',e);return loadLocal()}}

return { loadLocal, localSnapshot, openLocalStateDb, idbSyncPut, idbSyncGet, idbSyncDelete, persistBrowserStateSnapshot, queueBrowserStateSnapshot, loadBrowserStateSnapshot, restoreBrowserStateFallback, markCloudPending, getCloudPending, cloudPendingExists, clearCloudPending, loadCloudPendingState };
}

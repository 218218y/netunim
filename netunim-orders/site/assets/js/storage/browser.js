import {clone} from '../core/values.js';
import {STORAGE_KEY, LOCAL_DB, LOCAL_STORE, LOCAL_STATE_KEY, CLOUD_PENDING_KEY} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageBrowser({model, files, prepareState, normalizeState}){
function loadLocal(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch(e){console.error('local load',e);return null}}

function localSnapshot(source=model.state){const payload=prepareState(source);let localStorageOk=false;try{const text=JSON.stringify(payload);localStorage.setItem(STORAGE_KEY,text);if(localStorage.getItem(STORAGE_KEY)!==text)throw new Error('אימות השמירה המקומית נכשל');localStorageOk=true}catch(e){console.error('local snapshot',e)}queueBrowserStateSnapshot(payload);return localStorageOk}

async function openLocalStateDb(){return await new Promise((resolve,reject)=>{const r=indexedDB.open(LOCAL_DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(LOCAL_STORE))r.result.createObjectStore(LOCAL_STORE)};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}

async function persistBrowserStateSnapshot(payload){const db=await openLocalStateDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(LOCAL_STORE,'readwrite');tx.objectStore(LOCAL_STORE).put({payload:clone(payload),savedAt:Date.parse(payload?._meta?.savedAt||'')||Date.now()},LOCAL_STATE_KEY);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('שמירת IndexedDB בוטלה'))})}

function queueBrowserStateSnapshot(payload){files.browserStatePendingPayload=clone(payload);if(files.browserStateWritePromise)return files.browserStateWritePromise;files.browserStateWritePromise=(async()=>{while(files.browserStatePendingPayload){const next=files.browserStatePendingPayload;files.browserStatePendingPayload=null;await persistBrowserStateSnapshot(next)}})().catch(e=>{console.error('browser state mirror',e)}).finally(()=>{files.browserStateWritePromise=null;if(files.browserStatePendingPayload)queueBrowserStateSnapshot(files.browserStatePendingPayload)});return files.browserStateWritePromise}

async function loadBrowserStateSnapshot(){try{const db=await openLocalStateDb();return await new Promise((resolve,reject)=>{const r=db.transaction(LOCAL_STORE).objectStore(LOCAL_STORE).get(LOCAL_STATE_KEY);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)})}catch(e){console.error('browser state load',e);return null}}

async function restoreBrowserStateFallback(){const record=await loadBrowserStateSnapshot();if(!record?.payload)return false;const local=loadLocal(),localTime=Date.parse(local?._meta?.savedAt||'')||0,idbTime=Number(record.savedAt||Date.parse(record.payload?._meta?.savedAt||'')||0);if(!local||(localTime>0&&idbTime>localTime)){model.state=normalizeState(clone(record.payload));try{localStorage.setItem(STORAGE_KEY,JSON.stringify(record.payload))}catch(e){console.error('restore localStorage from IndexedDB',e)}return true}return false}

function markCloudPending(){try{const text=JSON.stringify({pending:true,updatedAt:new Date().toISOString()});localStorage.setItem(CLOUD_PENDING_KEY,text);if(localStorage.getItem(CLOUD_PENDING_KEY)!==text)throw new Error('אימות סימון pending נכשל');return true}catch(e){console.error('cloud pending marker',e);return false}}

function cloudPendingExists(){return !!localStorage.getItem(CLOUD_PENDING_KEY)}

function clearCloudPending(){localStorage.removeItem(CLOUD_PENDING_KEY)}

function loadCloudPendingState(){try{const raw=localStorage.getItem(CLOUD_PENDING_KEY);if(!raw)return null;const pending=JSON.parse(raw);if(pending?.pending===true)return loadLocal();return pending&&typeof pending==='object'?pending:null}catch(e){console.error('cloud pending load',e);return loadLocal()}}

return { loadLocal, localSnapshot, openLocalStateDb, persistBrowserStateSnapshot, queueBrowserStateSnapshot, loadBrowserStateSnapshot, restoreBrowserStateFallback, markCloudPending, cloudPendingExists, clearCloudPending, loadCloudPendingState };
}

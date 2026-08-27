import {DIR_DB, DIR_STORE} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageIndexedDb({}){
async function openDirDb(){return await new Promise((resolve,reject)=>{const r=indexedDB.open(DIR_DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(DIR_STORE))r.result.createObjectStore(DIR_STORE)};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}

async function saveDirHandle(h){const db=await openDirDb();return await new Promise((res,rej)=>{const tx=db.transaction(DIR_STORE,'readwrite');tx.objectStore(DIR_STORE).put(h,'main');tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}

async function loadDirHandle(){try{const db=await openDirDb();return await new Promise((res,rej)=>{const r=db.transaction(DIR_STORE).objectStore(DIR_STORE).get('main');r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error)})}catch(e){return null}}

async function requestPersistentBrowserStorage(){try{if(navigator.storage?.persist)await navigator.storage.persist()}catch(e){console.error('persistent storage',e)}}

return { openDirDb, saveDirHandle, loadDirHandle, requestPersistentBrowserStorage };
}

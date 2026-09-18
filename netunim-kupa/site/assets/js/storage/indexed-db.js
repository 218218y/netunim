import {createIndexedDbConnection} from '../shared/indexed-db-connection.js';


// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageIndexedDb({}){
const idbOpen=createIndexedDbConnection('kupa-portable-handles',2,db=>{if(!db.objectStoreNames.contains('handles'))db.createObjectStore('handles');if(!db.objectStoreNames.contains('sync'))db.createObjectStore('sync')});

async function idbPut(store,key,value){const db=await idbOpen();return await new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value,key);tx.oncomplete=()=>res(value);tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error('IndexedDB write aborted'))})}

async function idbGet(store,key){const db=await idbOpen();return await new Promise((res,rej)=>{const tx=db.transaction(store,'readonly');const q=tx.objectStore(store).get(key);q.onsuccess=()=>res(q.result??null);q.onerror=()=>rej(q.error)})}

async function idbDelete(store,key){const db=await idbOpen();return await new Promise((res,rej)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||new Error('IndexedDB delete aborted'))})}

async function rememberHandle(handle){try{await idbPut('handles','root',handle)}catch(e){console.error('remember root handle',e)}}

async function getRememberedHandle(){try{return await idbGet('handles','root')}catch(e){return null}}

async function rememberBackupHandle(handle){try{await idbPut('handles','backup-root',handle)}catch(e){console.error('remember backup handle',e)}}

async function getRememberedBackupHandle(){try{return await idbGet('handles','backup-root')}catch(e){return null}}

return { idbOpen, idbPut, idbGet, idbDelete, rememberHandle, getRememberedHandle, rememberBackupHandle, getRememberedBackupHandle };
}

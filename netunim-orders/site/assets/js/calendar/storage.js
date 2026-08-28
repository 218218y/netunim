const DB_NAME='order-management-google-calendar';
const DB_VERSION=1;
const QUEUE_STORE='pending-operations';
const CACHE_STORE='range-cache';
const META_STORE='meta';

// Calendar business data remains owned by Google. IndexedDB holds only a display cache
// and durable outbound operations that have not yet been acknowledged by Google.
export function createCalendarStorage(){
let dbPromise=null;
function requestResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function transactionDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('calendar_storage_aborted'))})}
function openDb(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(QUEUE_STORE))db.createObjectStore(QUEUE_STORE,{keyPath:'seq',autoIncrement:true});if(!db.objectStoreNames.contains(CACHE_STORE))db.createObjectStore(CACHE_STORE,{keyPath:'key'});if(!db.objectStoreNames.contains(META_STORE))db.createObjectStore(META_STORE,{keyPath:'key'})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});return dbPromise}

async function addOperation(operation){const db=await openDb(),tx=db.transaction(QUEUE_STORE,'readwrite'),store=tx.objectStore(QUEUE_STORE);const record={...structuredClone(operation),createdAt:operation.createdAt||new Date().toISOString(),attempts:Number(operation.attempts||0),lastError:String(operation.lastError||'')};delete record.seq;const seq=await requestResult(store.add(record));await transactionDone(tx);return Number(seq)}
async function listOperations(){const db=await openDb(),tx=db.transaction(QUEUE_STORE,'readonly');const rows=await requestResult(tx.objectStore(QUEUE_STORE).getAll());await transactionDone(tx);return rows.sort((a,b)=>Number(a.seq)-Number(b.seq))}
async function updateOperation(seq,patch){const db=await openDb(),tx=db.transaction(QUEUE_STORE,'readwrite'),store=tx.objectStore(QUEUE_STORE),current=await requestResult(store.get(Number(seq)));if(current)store.put({...current,...structuredClone(patch),seq:Number(seq)});await transactionDone(tx)}
async function deleteOperation(seq){const db=await openDb(),tx=db.transaction(QUEUE_STORE,'readwrite');tx.objectStore(QUEUE_STORE).delete(Number(seq));await transactionDone(tx)}
async function pendingCount(){const db=await openDb(),tx=db.transaction(QUEUE_STORE,'readonly');const count=await requestResult(tx.objectStore(QUEUE_STORE).count());await transactionDone(tx);return Number(count||0)}

async function putRangeCache(snapshot){const db=await openDb(),tx=db.transaction(CACHE_STORE,'readwrite');tx.objectStore(CACHE_STORE).put(structuredClone(snapshot));await transactionDone(tx)}
async function getRangeCache(key){const db=await openDb(),tx=db.transaction(CACHE_STORE,'readonly');const value=await requestResult(tx.objectStore(CACHE_STORE).get(String(key)));await transactionDone(tx);return value||null}
async function clearRangeCache(){const db=await openDb(),tx=db.transaction(CACHE_STORE,'readwrite');tx.objectStore(CACHE_STORE).clear();await transactionDone(tx)}

async function getMeta(key){const db=await openDb(),tx=db.transaction(META_STORE,'readonly');const row=await requestResult(tx.objectStore(META_STORE).get(String(key)));await transactionDone(tx);return row?.value??null}
async function putMeta(key,value){const db=await openDb(),tx=db.transaction(META_STORE,'readwrite');tx.objectStore(META_STORE).put({key:String(key),value:structuredClone(value)});await transactionDone(tx)}

return {openDb,addOperation,listOperations,updateOperation,deleteOperation,pendingCount,putRangeCache,getRangeCache,clearRangeCache,getMeta,putMeta};
}

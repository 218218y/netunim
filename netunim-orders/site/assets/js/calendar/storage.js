// @ts-check
import {calendarRequestResult as requestResult,runCalendarTransaction} from './transaction.js';
import {decodeCalendarCommand,decodeCalendarRetryPatch,decodePersistedCalendarOperation,decodePersistedCalendarOperations,decodePersistedCalendarRange,decodePersistedCalendarRanges,decodeCalendarAccountMeta} from './persisted-records.js';
import {createCalendarQueueObservation} from './queue-observation.js';
import {confirmCalendarPendingSnapshot} from './queue-confirmation.js';
import {authorizeCalendarDisplay} from './display-access.js';

const DB_NAME='order-management-google-calendar';
const DB_VERSION=1;
const QUEUE_STORE='pending-operations';
const CACHE_STORE='range-cache';
const META_STORE='meta';
const CONNECTION_PREF_KEY='orders.google-calendar.connection.v1';
// All adapter instances in this realm access the same physical queue. Observe
// them together so an inspection/second adapter cannot bypass the live receipt.
const queueObservation=createCalendarQueueObservation();

/** @typedef {import('./persisted-records.js').PersistedCalendarRange} CalendarRange */
/** @typedef {{key:string,rangeStart:string,rangeEnd:string,accountId:string,fetchedAt:string,owner?:string}} CalendarRangeIndex */
/** @template {CalendarRangeIndex} Row @param {readonly Row[]} rows @param {{startKey?:string,endKey?:string,accountId?:string,owner?:string|null}} [options] @returns {Row|null} */
export function selectCoveringRangeSnapshot(rows,{startKey='',endKey='',accountId='',owner=null}={}){
  const wantedStart=String(startKey||''),wantedEnd=String(endKey||''),wantedAccount=String(accountId||'').trim();
  if(!wantedStart||!wantedEnd)return null;
  const candidates=rows.filter(row=>{
    const rangeStart=String(row?.rangeStart||''),rangeEnd=String(row?.rangeEnd||''),rowAccount=String(row?.accountId||'').trim();
    return rangeStart&&rangeEnd&&rangeStart<=wantedStart&&rangeEnd>=wantedEnd&&(!wantedAccount||rowAccount===wantedAccount)&&(owner===null||row.owner===owner);
  });
  candidates.sort((a,b)=>{
    const aFetched=Date.parse(String(a?.fetchedAt||'')),bFetched=Date.parse(String(b?.fetchedAt||''));
    if(Number.isFinite(aFetched)&&Number.isFinite(bFetched)&&aFetched!==bFetched)return bFetched-aFetched;
    return String(a?.key||'').localeCompare(String(b?.key||''));
  });
  return candidates[0]||null;
}

// Calendar business data remains owned by Google. IndexedDB holds only a display cache
// and durable outbound operations that have not yet been acknowledged by Google.
/** @param {{onLocalCommit?:()=>void}} [ports] */
export function createCalendarStorage({onLocalCommit=()=>{}}={}){
/** @type {Promise<IDBDatabase>|null} */ let dbPromise=null;
// This optional hint follows commit. Its failure cannot undo a durable write.
function committed(){try{onLocalCommit()}catch(error){console.warn('Calendar commit notification failed',error)}}
function connectionPreference(){
  try{
    const raw=localStorage.getItem(CONNECTION_PREF_KEY);
    if(raw===null)return {known:false,autoConnect:false,accountId:''};
    /** @type {unknown} */ const value=JSON.parse(raw);
    const data=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    return {known:true,autoConnect:'autoConnect' in data&&data.autoConnect===true,accountId:'accountId' in data&&typeof data.accountId==='string'?data.accountId:''};
  }catch{return {known:false,autoConnect:false,accountId:''}}
}
/** @param {{autoConnect?:boolean,accountId?:string}} [preference] */
function saveConnectionPreference({autoConnect=false,accountId=''}={}){try{localStorage.setItem(CONNECTION_PREF_KEY,JSON.stringify({autoConnect:autoConnect===true,accountId:String(accountId||'').trim()}));return true}catch(e){return false}}

function openDb(){
  if(dbPromise)return dbPromise;
  /** @type {Promise<IDBDatabase>} */ const opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(QUEUE_STORE))db.createObjectStore(QUEUE_STORE,{keyPath:'seq',autoIncrement:true});
      if(!db.objectStoreNames.contains(CACHE_STORE))db.createObjectStore(CACHE_STORE,{keyPath:'key'});
      if(!db.objectStoreNames.contains(META_STORE))db.createObjectStore(META_STORE,{keyPath:'key'});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  // A transient failure must not permanently poison subsequent Calendar work.
  dbPromise=opening.catch(error=>{dbPromise=null;throw error});
  return dbPromise;
}

/** @template T @param {()=>Promise<T>} run @returns {Promise<T>} */
async function writeQueue(run){const settle=queueObservation.beginWrite();let succeeded=false;try{const result=await run();succeeded=true;return result}finally{settle();if(succeeded)committed()}}
/** @template T @param {string|string[]} stores @param {IDBTransactionMode} mode @param {(tx:IDBTransaction)=>T|PromiseLike<T>} run @returns {Promise<T>} */
async function transact(stores,mode,run){return runCalendarTransaction(await openDb(),stores,mode,run)}
/** @param {unknown} operation @returns {Promise<number>} */
async function addOperation(operation){
  const command=decodeCalendarCommand(operation);
  return writeQueue(()=>transact(QUEUE_STORE,'readwrite',async tx=>{
    const record={...command,createdAt:command.createdAt||new Date().toISOString()};
    const seq=await requestResult(tx.objectStore(QUEUE_STORE).add(record));
    if(typeof seq!=='number'||!Number.isSafeInteger(seq)||seq<1)throw new Error('calendar_operation_sequence_invalid');
    return seq;
  }));
}
async function listOperations(){
  const rows=await transact(QUEUE_STORE,'readonly',tx=>requestResult(tx.objectStore(QUEUE_STORE).getAll()));
  return decodePersistedCalendarOperations(rows);
}
async function readPendingSnapshot(){const isCurrent=queueObservation.capture(),operations=await listOperations();return Object.freeze({operations,isCurrent,isSettled:queueObservation.isSettled})}
/** @param {(snapshot:import('./queue-confirmation.js').PendingSnapshot)=>boolean} publish */
async function confirmPendingSnapshot(publish){return confirmCalendarPendingSnapshot(await openDb(),queueObservation,publish)}
/** @param {number} seq @param {unknown} patch @returns {Promise<void>} */
async function updateOperation(seq,patch){
  if(!Number.isSafeInteger(seq)||seq<1)throw new TypeError('calendar_operation_sequence_invalid');
  const update=decodeCalendarRetryPatch(patch);
  return writeQueue(()=>transact(QUEUE_STORE,'readwrite',async tx=>{
    const store=tx.objectStore(QUEUE_STORE),current=await requestResult(store.get(seq));
    const operation=decodePersistedCalendarOperation(current);
    store.put(decodePersistedCalendarOperation({...operation,...update,seq}));
  }));
}
/** @param {number} seq @returns {Promise<void>} */
async function deleteOperation(seq){
  if(!Number.isSafeInteger(seq)||seq<1)throw new TypeError('calendar_operation_sequence_invalid');
  return writeQueue(()=>transact(QUEUE_STORE,'readwrite',tx=>{tx.objectStore(QUEUE_STORE).delete(seq)}));
}
async function pendingCount(){
  const count=await transact(QUEUE_STORE,'readonly',tx=>requestResult(tx.objectStore(QUEUE_STORE).count()));
  if(typeof count!=='number'||!Number.isSafeInteger(count)||count<0)throw new Error('calendar_pending_count_invalid');
  return count;
}

/** @param {unknown} snapshot @returns {Promise<void>} */
async function putRangeCache(snapshot){
  const decoded=decodePersistedCalendarRange(snapshot);
  await transact(CACHE_STORE,'readwrite',tx=>{tx.objectStore(CACHE_STORE).put(decoded)});committed();
}
/** @param {string} key @returns {Promise<CalendarRange|null>} */
async function getRangeCache(key){
  const value=await transact(CACHE_STORE,'readonly',tx=>requestResult(tx.objectStore(CACHE_STORE).get(String(key))));
  return value===undefined?null:decodePersistedCalendarRange(value);
}
/** @param {string} startKey @param {string} endKey @param {string} [accountId] @returns {Promise<CalendarRange|null>} */
async function getRangeCacheCovering(startKey,endKey,accountId=''){
  const rows=await transact(CACHE_STORE,'readonly',tx=>requestResult(tx.objectStore(CACHE_STORE).getAll()));
  return selectCoveringRangeSnapshot(decodePersistedCalendarRanges(rows),{startKey,endKey,accountId});
}
// Cache attribution, queue and Google account share one native read snapshot.
// Decoders run before display authority, without filtering invalid pending work.
/** @param {string} owner @param {string} startKey @param {string} endKey */
async function readDisplaySnapshot(owner,startKey,endKey){
  if(typeof owner!=='string'||!owner)return null;
  const [rows,operations,account]=await transact([CACHE_STORE,QUEUE_STORE,META_STORE],'readonly',tx=>Promise.all([
    requestResult(tx.objectStore(CACHE_STORE).getAll()),
    requestResult(tx.objectStore(QUEUE_STORE).getAll()),
    requestResult(tx.objectStore(META_STORE).get('accountId')),
  ]));
  const accountId=decodeCalendarAccountMeta(account);
  const snapshot=selectCoveringRangeSnapshot(decodePersistedCalendarRanges(rows),{startKey,endKey,owner,accountId}),pending=decodePersistedCalendarOperations(operations);
  if(!snapshot||!authorizeCalendarDisplay(snapshot,pending,accountId,owner))return null;
  return {snapshot,pending};
}
async function clearRangeCache(){await transact(CACHE_STORE,'readwrite',tx=>{tx.objectStore(CACHE_STORE).clear()});committed()}

/** @param {string} key @returns {Promise<unknown>} */
async function getMeta(key){
  const row=await transact(META_STORE,'readonly',tx=>requestResult(tx.objectStore(META_STORE).get(String(key))));
  if(String(key)==='accountId')return row===undefined?null:decodeCalendarAccountMeta(row);
  return row&&typeof row==='object'&&!Array.isArray(row)&&'value' in row?row.value:null;
}
/** @param {string} key @param {unknown} value @returns {Promise<void>} */
async function putMeta(key,value){
  if(String(key)==='accountId')decodeCalendarAccountMeta({key:'accountId',value});
  await transact(META_STORE,'readwrite',tx=>{tx.objectStore(META_STORE).put({key:String(key),value:structuredClone(value)})});
}

return {openDb,addOperation,listOperations,readPendingSnapshot,confirmPendingSnapshot,updateOperation,deleteOperation,pendingCount,putRangeCache,getRangeCache,getRangeCacheCovering,readDisplaySnapshot,clearRangeCache,getMeta,putMeta,connectionPreference,saveConnectionPreference};
}

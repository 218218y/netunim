// @ts-check
// Workbook payloads and the outbox live only in IndexedDB. localStorage holds
// at most a bounded emergency journal, never full workbooks or base snapshots.
import {createIndexedDbConnection,completeIndexedDbTransaction} from './indexed-db-connection.js';

/** @typedef {{rowId:string,columnId:string,value:string,updatedAt?:string,generation?:number}} SpreadsheetDraft
 * @typedef {Pick<Storage,'getItem'|'setItem'|'removeItem'>} EmergencyStore
 * @typedef {{record:unknown,drafts:unknown[]}} SpreadsheetStoredRead */
/** @param {unknown} value @returns {value is SpreadsheetDraft} */
function draft(value){
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  return 'rowId' in value&&typeof value.rowId==='string'&&
    'columnId' in value&&typeof value.columnId==='string'&&
    'value' in value&&typeof value.value==='string'&&
    (!('updatedAt' in value)||typeof value.updatedAt==='string')&&
    (!('generation' in value)||typeof value.generation==='number'&&Number.isSafeInteger(value.generation)&&value.generation>=0);
}
/** @param {unknown} input @returns {SpreadsheetDraft[]} */
function captureDrafts(input){
  if(!Array.isArray(input))throw new Error('spreadsheet_drafts_invalid');
  return input.map((/** @type {unknown} */ value)=>{
    if(!draft(value))throw new Error('spreadsheet_drafts_invalid');
    return structuredClone(value);
  });
}
/** @param {{indexedDB?:IDBFactory,emergency?:EmergencyStore|null}} [options] */
export function createSpreadsheetStore({indexedDB=globalThis.indexedDB,emergency=globalThis.localStorage}={}){
  const open=createIndexedDbConnection('netunim-spreadsheets',1,db=>{
    db.createObjectStore('documents');db.createObjectStore('drafts');
  },{indexedDB,stopOnVersionChange:true});
  /** @param {IDBTransactionMode} mode */
  async function begin(mode){
    const db=await open();
    try{return db.transaction(['documents','drafts'],mode)}catch(error){
      // Only transaction creation is retryable. Never replay a started write.
      if(!(error instanceof Error)||error.name!=='InvalidStateError')throw error;
      open.invalidate(db);
      return (await open()).transaction(['documents','drafts'],mode);
    }
  }
  /** @template T @param {IDBTransactionMode} mode
   * @param {(tx:IDBTransaction,done:(value:T)=>undefined,fail:(cause:unknown)=>undefined)=>undefined} operation */
  function transaction(mode,operation){
    return completeIndexedDbTransaction(()=>begin(mode),operation,'spreadsheet_storage_aborted');
  }
  /** Invoke synchronously while the readonly transaction owns both stores.
   * Conflicting writes, including other tabs, cannot commit before publication.
   * @template T @param {string} key @param {(value:SpreadsheetStoredRead)=>T} publish
   * @returns {Promise<T>} */
  function withSnapshot(key,publish){
    return transaction('readonly',(tx,done,fail)=>{
      const record=tx.objectStore('documents').get(key),patches=tx.objectStore('drafts').get(key);
      let count=0;
      const read=()=>{if(++count===2){try{
        /** @type {unknown} */ const raw=patches.result;
        if(raw!=null&&!Array.isArray(raw))throw new Error('spreadsheet_drafts_invalid');
        const result=publish({record:record.result??null,drafts:raw??[]});
        // A dispatched fetch may reject before IDB's completion event.
        void Promise.resolve(result).catch(()=>{});done(result);
      }catch(error){fail(error)}}};
      record.onsuccess=read;patches.onsuccess=read;
    });
  }
  /** @param {string} key @returns {Promise<SpreadsheetStoredRead>} */
  function load(key){return withSnapshot(key,value=>value)}
  /** Capture before opening/queuing IDB. The caller cannot mutate accepted work.
   * @param {string} key @param {unknown} record @returns {Promise<boolean>} */
  async function commit(key,record){
    const captured=structuredClone(record);
    return transaction('readwrite',(tx,done)=>{
      tx.objectStore('documents').put(captured,key);
      tx.objectStore('drafts').delete(key);done(true);
    });
  }
  /** @param {string} key @param {SpreadsheetDraft[]} patches @returns {Promise<boolean>} */
  async function journal(key,patches){
    const captured=captureDrafts(patches);
    return transaction('readwrite',(tx,done,fail)=>{
      const store=tx.objectStore('drafts'),request=store.get(key);
      request.onsuccess=()=>{try{
        const prior=captureDrafts(request.result??[]);
        const map=new Map(prior.map(patch=>[patch.rowId+'\u0000'+patch.columnId,patch]));
        for(const patch of captured)map.set(patch.rowId+'\u0000'+patch.columnId,patch);
        store.put([...map.values()],key);done(true);
      }catch(error){fail(error)}};
    });
  }
  /** @param {string} key */
  function emergencyKey(key){return 'netunim-sheet-draft:'+key}
  /** @param {string} key @param {SpreadsheetDraft[]} patches */
  function saveEmergency(key,patches){
    try{
      const data=JSON.stringify(captureDrafts(patches));
      if(data.length>65536||!emergency&&patches.length>0)return false;
      if(patches.length)emergency?.setItem(emergencyKey(key),data);
      else emergency?.removeItem(emergencyKey(key));
      return true;
    }catch{return false}
  }
  /** Historical emergency data stays unknown until the sync owner's validation.
   * @param {string} key @returns {unknown[]} */
  function readEmergency(key){
    try{
      /** @type {unknown} */ const value=JSON.parse(emergency?.getItem(emergencyKey(key))||'[]');
      return Array.isArray(value)?value:[];
    }catch{return []}
  }
  /** Strict monitoring read: unreadable recovery data is never an empty journal.
   * @param {string} key @returns {SpreadsheetDraft[]} */
  function inspectEmergency(key){
    if(!emergency)throw new Error('spreadsheet_emergency_unavailable');
    return captureDrafts(JSON.parse(emergency.getItem(emergencyKey(key))||'[]'));
  }
  return {load,withSnapshot,commit,journal,saveEmergency,readEmergency,inspectEmergency};
}

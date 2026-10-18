// Workbook payloads and the outbox live only in IndexedDB. localStorage holds
// at most a bounded emergency journal, never full workbooks or base snapshots.
import {createIndexedDbConnection} from './indexed-db-connection.js';

export function createSpreadsheetStore({indexedDB=globalThis.indexedDB,emergency=globalThis.localStorage}={}){
  const open=createIndexedDbConnection('netunim-spreadsheets',1,db=>{
    db.createObjectStore('documents');db.createObjectStore('drafts');
  },{indexedDB,stopOnVersionChange:true});
  async function begin(mode){
    const db=await open();
    try{return db.transaction(['documents','drafts'],mode)}catch(error){
      // Only transaction creation is retryable. Never replay a started write.
      if(error?.name!=='InvalidStateError')throw error;
      open.invalidate(db);
      return (await open()).transaction(['documents','drafts'],mode);
    }
  }
  async function transaction(mode,operation){
    const tx=await begin(mode);
    return new Promise((resolve,reject)=>{
      let result,error;
      const fail=cause=>{error=cause;try{tx.abort()}catch{reject(cause)}};
      tx.oncomplete=()=>error?reject(error):resolve(result);
      tx.onerror=()=>{error??=tx.error};
      tx.onabort=()=>reject(error||tx.error||new Error('spreadsheet_storage_aborted'));
      try{operation(tx,value=>{result=value},fail)}catch(cause){fail(cause)}
    });
  }
  async function load(key){return transaction('readonly',(tx,done)=>{const record=tx.objectStore('documents').get(key),draft=tx.objectStore('drafts').get(key);let count=0;const read=()=>{if(++count===2)done({record:record.result||null,drafts:draft.result||[]})};record.onsuccess=read;draft.onsuccess=read})}
  async function commit(key,record){return transaction('readwrite',(tx,done)=>{tx.objectStore('documents').put(record,key);tx.objectStore('drafts').delete(key);done(true)})}
  async function journal(key,patches){return transaction('readwrite',(tx,done,fail)=>{
    const store=tx.objectStore('drafts'),request=store.get(key);
    request.onsuccess=()=>{try{
      const map=new Map((request.result||[]).map(patch=>[patch.rowId+'\u0000'+patch.columnId,patch]));
      for(const patch of patches)map.set(patch.rowId+'\u0000'+patch.columnId,patch);
      store.put([...map.values()],key);done(true);
    }catch(error){fail(error)}};
  })}
  function emergencyKey(key){return 'netunim-sheet-draft:'+key}
  function saveEmergency(key,patches){const data=JSON.stringify(patches);if(data.length>65536)return false;try{if(patches.length)emergency?.setItem(emergencyKey(key),data);else emergency?.removeItem(emergencyKey(key));return true}catch{return false}}
  function readEmergency(key){try{const value=JSON.parse(emergency?.getItem(emergencyKey(key))||'[]');return Array.isArray(value)?value:[]}catch{return []}}
  return {load,commit,journal,saveEmergency,readEmergency};
}

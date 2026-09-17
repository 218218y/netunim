// Workbook payloads and the outbox live only in IndexedDB. localStorage holds
// at most a bounded emergency journal, never full workbooks or base snapshots.
export function createSpreadsheetStore({indexedDB=globalThis.indexedDB,emergency=globalThis.localStorage}={}){
  let opening;
  function open(){return opening??=new Promise((resolve,reject)=>{const request=indexedDB.open('netunim-spreadsheets',1);request.onupgradeneeded=()=>{request.result.createObjectStore('documents');request.result.createObjectStore('drafts')};request.onsuccess=()=>resolve(request.result);request.onerror=()=>{opening=null;reject(request.error)}})}
  async function transaction(mode,operation){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(['documents','drafts'],mode);let result;operation(tx,value=>{result=value});tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('spreadsheet_storage_aborted'))})}
  async function load(key){return transaction('readonly',(tx,done)=>{const record=tx.objectStore('documents').get(key),draft=tx.objectStore('drafts').get(key);let count=0;const read=()=>{if(++count===2)done({record:record.result||null,drafts:draft.result||[]})};record.onsuccess=read;draft.onsuccess=read})}
  async function commit(key,record){return transaction('readwrite',(tx,done)=>{tx.objectStore('documents').put(record,key);tx.objectStore('drafts').delete(key);done(true)})}
  async function journal(key,patches){return transaction('readwrite',(tx,done)=>{const store=tx.objectStore('drafts'),request=store.get(key);request.onsuccess=()=>{const map=new Map((request.result||[]).map(patch=>[patch.rowId+'\u0000'+patch.columnId,patch]));for(const patch of patches)map.set(patch.rowId+'\u0000'+patch.columnId,patch);store.put([...map.values()],key);done(true)}})}
  function emergencyKey(key){return 'netunim-sheet-draft:'+key}
  function saveEmergency(key,patches){const data=JSON.stringify(patches);if(data.length>65536)return false;try{if(patches.length)emergency?.setItem(emergencyKey(key),data);else emergency?.removeItem(emergencyKey(key));return true}catch{return false}}
  function readEmergency(key){try{const value=JSON.parse(emergency?.getItem(emergencyKey(key))||'[]');return Array.isArray(value)?value:[]}catch{return []}}
  return {load,commit,journal,saveEmergency,readEmergency};
}

import {createIndexedDbConnection,completeIndexedDbTransaction} from './indexed-db-connection.js';

// Each update reads inside the same IDB transaction: a late RPC receipt cannot
// overwrite an intent already advanced by a replacement primary tab.
export function createSyncIncidentStore({indexedDB=globalThis.indexedDB}={}){
  const open=createIndexedDbConnection('netunim-sync-incidents',1,db=>db.createObjectStore('domains'),{indexedDB,stopOnVersionChange:true});
  async function update(key,change){
    return completeIndexedDbTransaction(async()=>(await open()).transaction('domains','readwrite'),(tx,done,fail)=>{
      const store=tx.objectStore('domains'),read=store.get(key);
      read.onsuccess=()=>{try{
        const prior=read.result||{version:1,pendingSince:null,episodes:[]};
        if(prior.version!==1||!Array.isArray(prior.episodes)||prior.pendingSince!==null&&!Number.isFinite(prior.pendingSince))throw new Error('sync_incident_local_record_invalid');
        const before=JSON.stringify(prior),next=change(prior);
        if(JSON.stringify(next)!==before)store.put(next,key);
        done(structuredClone(next));
      }catch(error){fail(error)}};
    },'sync_incident_transaction_aborted');
  }
  return {update};
}

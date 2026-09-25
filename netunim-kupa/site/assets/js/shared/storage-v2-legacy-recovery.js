// Read-only inventory of business storage from browsers that missed account
// cutover. The source remains in place; the fenced transaction copies it to
// Storage V2 before treating cloud data as authoritative.
const LEGACY_SOURCES={
  orders:{
    localStorage:['orders.management.state.v1','orders.supabase.base.v1','orders.supabase.pending.v1',
      'orders.shared.checks.base.v1','orders.shared.checks.bank-events.v1','orders.shared.checks.pending.v1',
      'orders.kupa.checks.base.v1','orders.kupa.checks.pending.v1'],
    indexedDb:{name:'order-management-local-state',stores:{snapshots:['main'],sync:['orders-outbox-v3','shared-checks-outbox-v3']}},
  },
  kupa:{
    localStorage:['kupa.browser.state.v1','kupa.cloud.pending.local.v1','kupa.shared.checks.base.v1',
      'kupa.shared.checks.bank-events.v1','kupa.shared.checks.pending.v1'],
    indexedDb:{name:'kupa-portable-handles',stores:{sync:['browser-state-v1','cloud-pending-v2','cloud-pending-v3','shared-checks-outbox-v3']}},
  },
};

async function readExistingDatabase(indexedDb,{name,stores}){
  if(typeof indexedDb?.open!=='function')throw new Error('storage_legacy_inventory_unavailable');
  // Opening without a version never upgrades an existing database. If it does
  // not exist, abort its version-zero creation so the inventory stays read-only.
  const database=await new Promise((resolve,reject)=>{
    const request=indexedDb.open(name);let absent=false;
    request.onupgradeneeded=event=>{absent=event.oldVersion===0;request.transaction.abort()};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>absent?resolve(null):reject(request.error||new Error('storage_legacy_database_open_failed'));
  });
  if(!database)return {};
  try{
    const found={};
    for(const [storeName,keys] of Object.entries(stores)){
      if(!database.objectStoreNames.contains(storeName))continue;
      const records=await new Promise((resolve,reject)=>{
        const tx=database.transaction(storeName,'readonly'),store=tx.objectStore(storeName),result={};
        for(const key of keys){const request=store.get(key);request.onsuccess=()=>{if(request.result!==undefined&&request.result!==null)result[key]=request.result}}
        tx.oncomplete=()=>resolve(result);
        tx.onabort=()=>reject(tx.error||new Error('storage_legacy_database_read_aborted'));
        tx.onerror=()=>reject(tx.error||new Error('storage_legacy_database_read_failed'));
      });
      if(Object.keys(records).length)found[storeName]=records;
    }
    return found;
  }finally{database.close()}
}

export async function captureFencedLegacyRecovery(app,{storage=globalThis.localStorage,indexedDb=globalThis.indexedDB}={}){
  const source=LEGACY_SOURCES[app];if(!source)throw new Error('storage_legacy_recovery_app_invalid');
  const localStorageRecords={};
  for(const key of source.localStorage){const value=storage.getItem(key);if(value!==null)localStorageRecords[key]=value}
  const indexedDbRecords=await readExistingDatabase(indexedDb,source.indexedDb);
  return {format:'business-storage-v1',localStorage:localStorageRecords,indexedDb:indexedDbRecords};
}

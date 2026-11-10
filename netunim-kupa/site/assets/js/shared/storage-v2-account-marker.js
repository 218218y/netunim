import {createStorageJournalDb} from './storage-journal-idb.js';
import {storageAccountMarkerCacheKey} from './storage-v2-activation-cache.js';

// IndexedDB is the durable marker. The historical `cutovers` store and cache
// key remain unchanged for installed V2 browsers. LocalStorage is only a
// synchronous routing cache; a disagreement blocks startup.
/** @typedef {import('./storage-v2-runtime-contracts.js').App} App */
/** @typedef {import('./storage-journal-db.js').StorageJournalDb} JournalDb */
/** @param {Partial<{app:App,owner:()=>string,primary:()=>boolean,db:Pick<JournalDb,'readV2Marker'|'markAccountMarker'>,storage:Pick<Storage,'getItem'|'setItem'>}>} [options] */
export function createStorageV2AccountMarker({app:site,owner,primary:isPrimary,db=createStorageJournalDb(),storage=globalThis.localStorage}={}){
  if((site!=='orders'&&site!=='kupa')||typeof owner!=='function'||typeof isPrimary!=='function')throw new Error('storage_cutover_configuration');
  const app=site,primary=isPrimary;
  const scope=()=>String(owner()||'local');
  async function verify(){
    const identity=scope(),record=await db.readV2Marker(`${app}:${identity}`);
    if(identity!==scope())throw new Error('storage_cutover_owner_changed');
    const key=storageAccountMarkerCacheKey(app,identity),cache=storage?.getItem(key);
    if(record&&(record.version!==2||record.owner!==identity||record.app!==app||record.scope!==`${app}:${identity}`)||cache&&cache!=='2'||!record&&cache==='2')throw new Error('storage_cutover_marker_mismatch');
    if(record&&cache==null){
      // IDB is authoritative. A cleared synchronous cache may be repaired in
      // this direction only; a cache without a durable marker never promotes.
      if(!storage)throw new Error('storage_cutover_cache_failed');
      storage.setItem(key,'2');
      if(storage.getItem(key)!=='2')throw new Error('storage_cutover_cache_failed');
    }
    return !!record;
  }
  async function mark(){
    if(!primary())throw new Error('storage_cutover_preflight_required');
    const identity=scope();
    if(identity!==scope()||!primary())throw new Error('storage_cutover_owner_changed');
    const record=await db.markAccountMarker(app,identity);
    if(identity!==scope()||!primary())throw new Error('storage_cutover_owner_changed');
    // Failure to cache is safe: verify() will block startup until repaired.
    storage.setItem(storageAccountMarkerCacheKey(app,identity),'2');
    if(storage.getItem(storageAccountMarkerCacheKey(app,identity))!=='2')throw new Error('storage_cutover_cache_failed');
    return record;
  }
  return {verify,mark};
}

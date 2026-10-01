import {createStorageJournalDb} from './storage-journal-idb.js';

export function storageCutoverKey(app,owner){return `netunim-storage-cutover-version:${app}:${String(owner||'local')}`}

// IndexedDB is the durable marker. LocalStorage is a synchronous cache for
// hot-path writers. A disagreement blocks startup instead of downgrading.
export function createStorageV2Cutover({app,owner,primary,db=createStorageJournalDb(),storage=globalThis.localStorage}={}){
  if(!['orders','kupa'].includes(app)||typeof owner!=='function'||typeof primary!=='function')throw new Error('storage_cutover_configuration');
  const scope=()=>String(owner()||'local');
  async function verify(){
    const identity=scope(),record=await db.readCutover(`${app}:${identity}`);
    if(identity!==scope())throw new Error('storage_cutover_owner_changed');
    const key=storageCutoverKey(app,identity),cache=storage?.getItem(key);
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
  async function mark({verifyLegacyClean}={}){
    if(!primary()||typeof verifyLegacyClean!=='function')throw new Error('storage_cutover_preflight_required');
    const identity=scope();
    if(await verifyLegacyClean()!==true)throw new Error('storage_cutover_legacy_pending');
    if(identity!==scope()||!primary())throw new Error('storage_cutover_owner_changed');
    const record=await db.markCutover(app,identity);
    if(identity!==scope()||!primary())throw new Error('storage_cutover_owner_changed');
    // Failure to cache is safe: verify() will block startup until repaired.
    storage.setItem(storageCutoverKey(app,identity),'2');
    if(storage.getItem(storageCutoverKey(app,identity))!=='2')throw new Error('storage_cutover_cache_failed');
    return record;
  }
  async function legacyInactive(){
    const identity=scope();
    const result=await db.fencedLegacyInactive(app,identity);
    if(identity!==scope())throw new Error('storage_cutover_owner_changed');
    return result;
  }
  return {verify,mark,legacyInactive};
}

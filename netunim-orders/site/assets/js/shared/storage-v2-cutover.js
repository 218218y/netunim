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
    const cache=storage?.getItem(storageCutoverKey(app,identity));
    if((record?.version===2)!==(cache==='2')||record&&record.owner!==identity||cache&&cache!=='2')throw new Error('storage_cutover_marker_mismatch');
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
  return {verify,mark};
}

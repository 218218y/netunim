import {createStorageJournalDb} from './storage-journal-idb.js';
import {createStorageOwnerBinding as createBinding} from './storage-owner-binding.js';
export {STORAGE_OWNER_UNBOUND,storageOwnerCacheKey,storageOwnerReady} from './storage-owner-binding.js';

// Browser/default database composition. The authority implementation is checked.
export function createStorageOwnerBinding({app,primary=()=>true,db=createStorageJournalDb(),storage=globalThis.localStorage,now=()=>new Date().toISOString(),operationId=()=>globalThis.crypto?.randomUUID?.()||`handoff-${Date.now()}-${Math.random().toString(16).slice(2)}`}={}){
  return createBinding({app,primary,db,storage,now,operationId});
}

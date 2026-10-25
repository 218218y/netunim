// Historical persisted names are retained so existing V2 browsers keep their
// durable markers. This cache selects the V2 path; IndexedDB verification must
// still succeed before startup can expose or mutate business state.
/** @param {string} app @param {string} owner */
export function storageAccountMarkerCacheKey(app,owner){
  return `netunim-storage-cutover-version:${app}:${String(owner||'local')}`;
}

/** @param {string} app */
export function storageLocalEngineCacheKey(app){
  return `netunim-storage-engine-version:${app}:local`;
}

/** @param {string} app @param {string} owner @param {Pick<Storage,'getItem'>} [storage] */
export function isStorageV2ActivationCached(app,owner,storage=globalThis.localStorage){
  const identity=String(owner||'local');
  return storage?.getItem(storageAccountMarkerCacheKey(app,identity))==='2'||
    owner==='local'&&storage?.getItem(storageLocalEngineCacheKey(app))==='2';
}

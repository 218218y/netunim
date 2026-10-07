// Historical persisted names are retained so existing V2 browsers keep their
// durable markers. This cache selects the V2 path; IndexedDB verification must
// still succeed before startup can expose or mutate business state.
export function storageAccountMarkerCacheKey(app,owner){
  return `netunim-storage-cutover-version:${app}:${String(owner||'local')}`;
}

export function storageLocalEngineCacheKey(app){
  return `netunim-storage-engine-version:${app}:local`;
}

export function isStorageV2ActivationCached(app,owner,storage=globalThis.localStorage){
  const identity=String(owner||'local');
  return storage?.getItem(storageAccountMarkerCacheKey(app,identity))==='2'||
    owner==='local'&&storage?.getItem(storageLocalEngineCacheKey(app))==='2';
}

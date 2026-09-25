const RESET_CHANNEL='netunim:local-site-reset:v1';
const RESET_PAGE='./reset-local.html';
const KNOWN_DATABASES=Object.freeze([
  'netunim-storage-v2',
  'netunim-spreadsheets',
  'order-management-local-state',
  'order-management-portable-handles',
  'order-management-google-calendar',
  'kupa-portable-handles',
]);

function unique(values){return [...new Set(values.map(value=>String(value||'').trim()).filter(Boolean))]}

export function localSiteResetPageUrl(locationObject=globalThis.location,{peer=false}={}){
  const url=new URL(RESET_PAGE,locationObject.href);if(peer)url.searchParams.set('peer','1');return url.href
}

// Secondary tabs are parked on the reset page so their live IndexedDB handles,
// timers and writer locks cannot keep the primary tab's origin wipe blocked.
export function installLocalSiteResetPeerListener({locationObject=globalThis.location,BroadcastChannelImpl=globalThis.BroadcastChannel}={}){
  if(typeof BroadcastChannelImpl!=='function')return ()=>{};
  const channel=new BroadcastChannelImpl(RESET_CHANNEL),handler=event=>{
    if(event?.data?.type!=='prepare-local-site-reset')return;
    try{locationObject.replace(localSiteResetPageUrl(locationObject,{peer:true}))}catch{}
  };
  channel.addEventListener?.('message',handler);
  return ()=>{try{channel.removeEventListener?.('message',handler);channel.close?.()}catch{}}
}

export async function beginLocalSiteResetNavigation({locationObject=globalThis.location,BroadcastChannelImpl=globalThis.BroadcastChannel,setTimeoutImpl=globalThis.setTimeout}={}){
  if(typeof BroadcastChannelImpl==='function'){
    const channel=new BroadcastChannelImpl(RESET_CHANNEL);
    try{channel.postMessage({type:'prepare-local-site-reset'})}finally{try{channel.close?.()}catch{}}
    // Give already-open peer tabs one turn to leave the application before this
    // tab opens the reset-only page. The reset page still detects a blocked DB
    // and fails closed if a peer could not be parked.
    await new Promise(resolve=>setTimeoutImpl(resolve,80));
  }
  locationObject.replace(localSiteResetPageUrl(locationObject));
}

async function indexedDatabaseNames(indexedDb){
  if(typeof indexedDb?.databases!=='function')throw new Error('local_site_reset_indexeddb_inventory_unavailable');
  const discovered=[],rows=await indexedDb.databases();
  for(const row of rows||[])if(row?.name)discovered.push(row.name);
  return unique([...KNOWN_DATABASES,...discovered]);
}

function deleteIndexedDatabase(indexedDb,name,onProgress){
  return new Promise((resolve,reject)=>{
    let settled=false,blocked=false,timer=null;
    const finish=(fn,value)=>{if(settled)return;settled=true;if(timer!==null)clearTimeout(timer);fn(value)};
    let request;
    try{request=indexedDb.deleteDatabase(name)}catch(error){reject(error);return}
    request.onsuccess=()=>finish(resolve,true);
    request.onerror=()=>finish(reject,request.error||new Error(`local_site_reset_idb_delete_failed:${name}`));
    request.onblocked=()=>{blocked=true;onProgress?.({phase:'indexeddb-blocked',name})};
    timer=setTimeout(()=>finish(reject,new Error(`${blocked?'local_site_reset_idb_blocked':'local_site_reset_idb_timeout'}:${name}`)),8000);
  });
}

export async function clearCurrentOriginStorage({
  localStorageObject=globalThis.localStorage,
  sessionStorageObject=globalThis.sessionStorage,
  indexedDb=globalThis.indexedDB,
  cacheStorage=globalThis.caches,
  serviceWorker=globalThis.navigator?.serviceWorker,
  onProgress=()=>{},
}={}){
  onProgress({phase:'start'});

  // Delete durable business state first. If another tab still holds a database
  // open, stop here and keep the reset-only page active rather than returning to
  // a partially reset application. Peers were asked to park before this page ran.
  if(!indexedDb||typeof indexedDb.deleteDatabase!=='function')throw new Error('local_site_reset_indexeddb_unavailable');
  const databaseNames=await indexedDatabaseNames(indexedDb);
  onProgress({phase:'indexeddb',count:databaseNames.length});
  await Promise.all(databaseNames.map(name=>deleteIndexedDatabase(indexedDb,name,onProgress)));

  localStorageObject?.clear?.();
  sessionStorageObject?.clear?.();
  onProgress({phase:'web-storage'});

  if(typeof cacheStorage?.keys!=='function'||typeof cacheStorage?.delete!=='function')throw new Error('local_site_reset_cache_storage_unavailable');
  const cacheNames=await cacheStorage.keys();
  onProgress({phase:'caches',count:cacheNames.length});
  await Promise.all((cacheNames||[]).map(name=>cacheStorage.delete(name)));

  const registrations=typeof serviceWorker?.getRegistrations==='function'?await serviceWorker.getRegistrations():[];
  onProgress({phase:'service-workers',count:registrations.length});
  await Promise.all((registrations||[]).map(registration=>registration.unregister()));

  const leftovers=(await indexedDb.databases()).map(row=>row?.name).filter(Boolean);
  if(leftovers.length)throw new Error(`local_site_reset_idb_remaining:${leftovers.join(',')}`);
  if(Number(localStorageObject?.length||0)!==0||Number(sessionStorageObject?.length||0)!==0)throw new Error('local_site_reset_web_storage_remaining');
  const remainingCaches=await cacheStorage.keys();
  if(remainingCaches.length)throw new Error(`local_site_reset_cache_remaining:${remainingCaches.join(',')}`);
  onProgress({phase:'complete'});
  return {databases:databaseNames.length,caches:cacheNames.length,serviceWorkers:registrations.length};
}

export function localSiteResetChannelName(){return RESET_CHANNEL}

import {createStorageJournalDb} from './storage-journal-idb.js';
import {assertStorageJson} from './storage-journal-model.js';
import {equalSyncJson} from './cloud-sync.js';

export function storageLocalEngineKey(app){return `netunim-storage-engine-version:${app}:local`}

export async function verifyStorageV2LocalEngine({app,owner,db=createStorageJournalDb(),storage=globalThis.localStorage}={}){
  if(!['orders','kupa'].includes(app)||typeof owner!=='function')throw new Error('storage_local_engine_configuration');
  if(owner()!=='local')return false;
  const scope=`${app}:local`,record=await db.readLocalEngine(app);
  if(owner()!=='local')throw new Error('storage_local_birth_owner_changed');
  const key=storageLocalEngineKey(app),cache=storage?.getItem(key);
  if(record&&(record.version!==2||record.kind!=='local-engine'||record.scope!==scope||record.app!==app||record.owner!=='local')||cache&&cache!=='2'||!record&&cache==='2')throw new Error('storage_local_engine_marker_mismatch');
  if(record&&cache==null){
    if(!storage)throw new Error('storage_local_engine_cache_failed');
    storage.setItem(key,'2');if(storage.getItem(key)!=='2')throw new Error('storage_local_engine_cache_failed');
  }
  return !!record;
}

// This marker describes the local storage engine only. It never fabricates a
// cloud cursor, and a browser cache alone can never authorize a V2 writer.
export function createStorageV2LocalBirth({app,owner,primary,main,shared,enableShared=()=>{},readSource,quiesce=async()=>{},verifyLegacyClean,applyAuxiliary=async()=>{},verifyAuxiliary=async()=>true,db=createStorageJournalDb(),storage=globalThis.localStorage,operationId=()=>globalThis.crypto?.randomUUID?.()}={}){
  if(!['orders','kupa'].includes(app)||[owner,primary,main?.initializeLocal,main?.recover,shared?.initializeLocal,shared?.recover,readSource,quiesce,verifyLegacyClean,applyAuxiliary,verifyAuxiliary].some(value=>typeof value!=='function'))throw new Error('storage_local_birth_configuration');
  const scope=`${app}:local`,key=storageLocalEngineKey(app);
  let plan=null,running=null,freezing=false;
  const guard=()=>{if(owner()!=='local'||!primary())throw new Error('storage_local_birth_owner_changed')};
  function cacheMarker(){
    if(!storage)throw new Error('storage_local_engine_cache_failed');
    storage.setItem(key,'2');if(storage.getItem(key)!=='2')throw new Error('storage_local_engine_cache_failed');
  }
  async function verify(){
    return verifyStorageV2LocalEngine({app,owner,db,storage});
  }
  async function hydrate(){
    if(owner()!=='local'){plan=null;return null}
    const record=await db.readLocalBirth(scope);if(owner()!=='local')throw new Error('storage_local_birth_owner_changed');
    plan=record;return record&&structuredClone(record);
  }
  async function settledLegacy(){
    if(await verifyLegacyClean()!==true)throw new Error('storage_local_birth_legacy_pending');
  }
  async function execute(){
    guard();let current=plan||await hydrate();if(!current)throw new Error('storage_local_birth_missing');
    enableShared();
    while(current.phase!=='complete'){
      guard();
      if(current.phase==='prepared'){
        await main.initializeLocal(current.mainState,{appMetadata:{localBirthId:current.id}});
        current=await db.advanceLocalBirth(scope,current.id,'prepared','main-initialized');plan=current;continue;
      }
      if(current.phase==='main-initialized'){
        await shared.initializeLocal({state:current.sharedState});
        current=await db.advanceLocalBirth(scope,current.id,'main-initialized','shared-initialized');plan=current;continue;
      }
      if(current.phase==='shared-initialized'){
        if(current.auxiliaryState!=null){await applyAuxiliary(current.auxiliaryState);if(await verifyAuxiliary(current.auxiliaryState)!==true)throw new Error('storage_local_birth_auxiliary_unverified')}
        const mainState=(await main.recover(null))?.state,sharedState=(await shared.recover())?.state;
        if(!mainState||!sharedState||!equalSyncJson(mainState,current.mainState)||!equalSyncJson(sharedState,current.sharedState))throw new Error('storage_local_birth_parity_mismatch');
        await settledLegacy();
        current=await db.advanceLocalBirth(scope,current.id,'shared-initialized','verified');plan=current;continue;
      }
      if(current.phase==='verified'){
        if(current.auxiliaryState!=null&&await verifyAuxiliary(current.auxiliaryState)!==true)throw new Error('storage_local_birth_auxiliary_unverified');
        await settledLegacy();guard();await db.markLocalEngine(app);guard();cacheMarker();
        current=await db.advanceLocalBirth(scope,current.id,'verified','complete');plan=current;continue;
      }
      throw new Error('storage_local_birth_phase_invalid');
    }
    if(await verify()!==true)throw new Error('storage_local_birth_marker_missing');
    return structuredClone(current);
  }
  async function begin(){
    guard();if(running)return running;
    running=(async()=>{
      const existing=await hydrate(),marked=await verify();
      if(marked){
        // The marker is committed before the plan moves to complete. A crash in
        // that window must retire the plan instead of freezing startup forever.
        if(existing&&existing.phase!=='complete'){
          if(existing.phase!=='verified')throw new Error('storage_local_birth_marker_phase_mismatch');
          return execute();
        }
        return {already:true};
      }
      if(existing){if(existing.phase==='complete')throw new Error('storage_local_birth_marker_missing');return execute()}
      freezing=true;
      try{
        await quiesce();guard();await settledLegacy();
        const source=await readSource();guard();
        if(!source?.mainState||!source?.sharedState)throw new Error('storage_local_birth_source_missing');
        assertStorageJson(source.mainState);assertStorageJson(source.sharedState);if(source.auxiliaryState!=null)assertStorageJson(source.auxiliaryState);
        const id=String(operationId()||'').trim();if(!id)throw new Error('storage_local_birth_id_unavailable');
        const now=new Date().toISOString(),record={version:2,scope,app,owner:'local',id,phase:'prepared',mainState:structuredClone(source.mainState),sharedState:structuredClone(source.sharedState),auxiliaryState:source.auxiliaryState==null?null:structuredClone(source.auxiliaryState),createdAt:now,updatedAt:now};
        plan=await db.beginLocalBirth(scope,record);guard();return execute();
      }finally{freezing=false}
    })().finally(()=>{running=null});return running;
  }
  async function resume(){guard();if(running)return running;const current=await hydrate();if(!current)return null;if(current.phase==='complete')return verify();return begin()}
  return {verify,hydrate,begin,resume,get preparing(){return freezing||!!plan&&plan.phase!=='complete'},get plan(){return plan&&structuredClone(plan)}};
}

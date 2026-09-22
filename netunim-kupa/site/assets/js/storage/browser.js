import {measureStorage,stringifyStorage,writeVerifiedStorage} from '../shared/storage-metrics.js';
import {beginMeasure} from '../shared/runtime-performance.js';
import {clone} from '../core/values.js';
import {createOperationId} from '../shared/cloud-sync.js';
import {assertValidCloudState} from '../state/validation.js';
import {BROWSER_STATE_KEY, BROWSER_STATE_IDB_KEY} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageBrowser({storageV2=null,observeStorage=()=>{},legacyCloudPendingExists=()=>false,model, session, files, normalizeState, prepareKupaCloudState=state=>state, idbPut, idbGet}){
let sequenceLoaded=false,v2CloudStateCache=null;
// Another primary tab may have saved while this tab was inactive.
globalThis.addEventListener?.('storage',event=>{if(event.key===BROWSER_STATE_KEY||event.key===null)sequenceLoaded=false});
function nextSnapshotSequence(){
  if(!sequenceLoaded){session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),Number(loadBrowserStateSync()?.snapshotSeq||0));sequenceLoaded=true}
  return session.localSnapshotSeq=Number(session.localSnapshotSeq||0)+1;
}

function browserStateRecord(snapshot=model.state,revision=session.dbRevision,{normalized=false,owned=false,skipSequence=false}={}){if(!skipSequence)nextSnapshotSequence();return {schemaVersion:1,snapshotSeq:session.localSnapshotSeq,state:normalized?(owned?snapshot:measureStorage('checkpoint-clone',()=>clone(snapshot))):measureStorage('normalize',()=>normalizeState(snapshot)),revision:Number(revision||0),savedAt:new Date().toISOString()}}

function persistBrowserStateSync(record){try{const text=stringifyStorage('browser-snapshot',record);writeVerifiedStorage(localStorage,BROWSER_STATE_KEY,text);return true}catch(e){console.error('browser state localStorage',e);return false}}

function loadBrowserStateSync(){try{const raw=localStorage.getItem(BROWSER_STATE_KEY);return raw?JSON.parse(raw):null}catch(e){console.error('browser state local load',e);return null}}

function queueBrowserStateIdb(record){files.browserStatePendingRecord=clone(record);if(files.browserStateWritePromise)return files.browserStateWritePromise;files.browserStateWritePromise=(async()=>{while(files.browserStatePendingRecord){const next=files.browserStatePendingRecord;files.browserStatePendingRecord=null;await idbPut('sync',BROWSER_STATE_IDB_KEY,next)}})().catch(e=>console.error('browser state idb',e)).finally(()=>{files.browserStateWritePromise=null;if(files.browserStatePendingRecord)queueBrowserStateIdb(files.browserStatePendingRecord)});return files.browserStateWritePromise}

function persistImmediateBrowserSnapshot(snapshot=model.state,revision=session.dbRevision,options){const done=beginMeasure('kupa:local-snapshot');try{
  nextSnapshotSequence();const appMetadata={snapshotSeq:session.localSnapshotSeq,revision:Number(revision||0)},fast=storageV2?.persist?.(snapshot,options,appMetadata);if(fast?.handled){files.storageV2CommitPromise=fast.committed;if(fast.seq&&v2CloudStateCache?.base){session.storageV2CloudPending=true;v2CloudStateCache={...v2CloudStateCache,seq:Math.max(Number(v2CloudStateCache.seq||0),Number(fast.seq)),pending:true}}return true}
  const record=browserStateRecord(snapshot,revision,{...options,skipSequence:true});record.snapshotSeq=session.localSnapshotSeq;const ok=persistBrowserStateSync(record);queueBrowserStateIdb(record);try{if(storageV2)storageV2.afterLegacy(record.state,options,appMetadata);else observeStorage(record.state,options)}catch(error){console.error('storage V2 observation',error)}return ok
}finally{done()}}

async function loadBrowserState(){const local=loadBrowserStateSync();let idb=null;try{idb=await idbGet('sync',BROWSER_STATE_IDB_KEY)}catch(e){console.error('browser state idb load',e)}const lt=Number(local?.snapshotSeq||0),it=Number(idb?.snapshotSeq||0);session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),lt,it);const chosen=!local||it>lt?idb:local,recovered=await storageV2?.recover?.(chosen?.state||null,{snapshotSeq:Math.max(lt,it),revision:Number(chosen?.revision||0)});if(recovered){session.localSnapshotSeq=Math.max(session.localSnapshotSeq,Number(recovered.appMetadata?.snapshotSeq||0));return {schemaVersion:2,snapshotSeq:session.localSnapshotSeq,state:recovered.state,revision:Number(recovered.appMetadata?.revision||chosen?.revision||0),savedAt:new Date().toISOString()}}if(chosen){persistBrowserStateSync(chosen);queueBrowserStateIdb(chosen)}return chosen||null}

async function requestPersistentBrowserStorage(){try{if(navigator.storage?.persist)await navigator.storage.persist()}catch(e){console.error('persistent storage request',e)}}

function storageV2CloudOutboxActive(){return !!(storageV2?.primaryReady&&v2CloudStateCache?.base&&!legacyCloudPendingExists())}
async function refreshStorageV2CloudState(){
  if(!storageV2?.primaryReady){v2CloudStateCache=null;session.storageV2CloudPending=false;return null}
  const state=await storageV2.cloudState({validateBase:value=>assertValidCloudState(value,'Kupa V2 cloud base')});v2CloudStateCache=state;session.storageV2CloudPending=!!(state?.pending||state?.flight);if(state?.control?.conflict)session.cloudConflictPending=true;return state
}
async function initializeStorageV2CloudCursor(revision){
  if(!storageV2?.primaryReady||legacyCloudPendingExists())return false;
  await storageV2.flush();const base=await storageV2.captureCloudCursor(Number(revision||0),{project:state=>prepareKupaCloudState(state),validateBase:value=>assertValidCloudState(value,'Kupa V2 cloud base')});v2CloudStateCache={seq:base.ackSeq,base,flight:null,control:null,pending:false};session.storageV2CloudPending=false;return true
}
async function materializeStorageV2CloudFlight({throughSeq,snapshot}={}){
  const state=await refreshStorageV2CloudState();if(!state?.base)return null;if(state.flight)return state.flight;
  const flight=await storageV2.materializeFlight({operationId:createOperationId('kupa-v2'),baseRevision:Number(state.base.revision),throughSeq,snapshot,project:value=>prepareKupaCloudState(value),validateCloud:value=>assertValidCloudState(value,'Kupa V2 flight')});await refreshStorageV2CloudState();return flight
}
async function acknowledgeStorageV2CloudFlight(operationId,revision,state,{currentState=model.state,control=null}={}){assertValidCloudState(state,'Kupa V2 ACK base');await storageV2.acknowledgeFlight(operationId,Number(revision),state,{validateBase:value=>assertValidCloudState(value,'Kupa V2 ACK base'),currentState,control,appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}});return refreshStorageV2CloudState()}
async function rejectStorageV2CloudFlight(operationId,revision,state,{control=null}={}){assertValidCloudState(state,'Kupa V2 rebase base');const result=await storageV2.rejectFlight(operationId,Number(revision),state,{validateBase:value=>assertValidCloudState(value,'Kupa V2 rebase base'),control});await refreshStorageV2CloudState();return result}
async function setStorageV2CloudControl(control={}){const result=await storageV2.setCloudControl(control);await refreshStorageV2CloudState();return result}
async function clearStorageV2CloudControl(){const result=await storageV2.clearCloudControl();await refreshStorageV2CloudState();return result}
async function replaceStorageV2CurrentState(state=model.state){const result=await storageV2.replaceCurrentState(state,{appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(session.dbRevision||0),storageRole:'primary'}});await refreshStorageV2CloudState();return result}
async function adoptStorageV2CloudHead(revision,state=model.state){const cloud=prepareKupaCloudState(state);assertValidCloudState(cloud,'Kupa V2 adopted cloud head');const result=await storageV2.adoptCloudHead(Number(revision),cloud,state,{validateBase:value=>assertValidCloudState(value,'Kupa V2 adopted cloud head'),appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}});await refreshStorageV2CloudState();return result}
async function resetStorageV2CloudHead(revision,state=model.state){const cloud=prepareKupaCloudState(state);assertValidCloudState(cloud,'Kupa V2 reset cloud head');const result=await storageV2.resetCloudHead(Number(revision),cloud,state,{validateBase:value=>assertValidCloudState(value,'Kupa V2 reset cloud head'),appMetadata:{snapshotSeq:Number(session.localSnapshotSeq||0),revision:Number(revision||0),storageRole:'primary'}});await refreshStorageV2CloudState();session.cloudConflictPending=false;return result}

return { browserStateRecord, persistBrowserStateSync, loadBrowserStateSync, queueBrowserStateIdb, persistImmediateBrowserSnapshot, loadBrowserState, requestPersistentBrowserStorage, storageV2CloudOutboxActive, refreshStorageV2CloudState, initializeStorageV2CloudCursor, materializeStorageV2CloudFlight, acknowledgeStorageV2CloudFlight, rejectStorageV2CloudFlight, setStorageV2CloudControl, clearStorageV2CloudControl, replaceStorageV2CurrentState, adoptStorageV2CloudHead, resetStorageV2CloudHead, get storageV2CommitPromise(){return storageV2?.commitPromise||files.storageV2CommitPromise||Promise.resolve()} };
}

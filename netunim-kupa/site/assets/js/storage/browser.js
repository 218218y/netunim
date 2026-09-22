import {measureStorage,stringifyStorage,writeVerifiedStorage} from '../shared/storage-metrics.js';
import {beginMeasure} from '../shared/runtime-performance.js';
import {clone} from '../core/values.js';
import {BROWSER_STATE_KEY, BROWSER_STATE_IDB_KEY} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageBrowser({observeStorage=()=>{},model, session, files, normalizeState, idbPut, idbGet}){
let sequenceLoaded=false;
// Another primary tab may have saved while this tab was inactive.
globalThis.addEventListener?.('storage',event=>{if(event.key===BROWSER_STATE_KEY||event.key===null)sequenceLoaded=false});
function nextSnapshotSequence(){
  if(!sequenceLoaded){session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),Number(loadBrowserStateSync()?.snapshotSeq||0));sequenceLoaded=true}
  return session.localSnapshotSeq=Number(session.localSnapshotSeq||0)+1;
}

function browserStateRecord(snapshot=model.state,revision=session.dbRevision,{normalized=false,owned=false}={}){nextSnapshotSequence();return {schemaVersion:1,snapshotSeq:session.localSnapshotSeq,state:normalized?(owned?snapshot:measureStorage('checkpoint-clone',()=>clone(snapshot))):measureStorage('normalize',()=>normalizeState(snapshot)),revision:Number(revision||0),savedAt:new Date().toISOString()}}

function persistBrowserStateSync(record){try{const text=stringifyStorage('browser-snapshot',record);writeVerifiedStorage(localStorage,BROWSER_STATE_KEY,text);return true}catch(e){console.error('browser state localStorage',e);return false}}

function loadBrowserStateSync(){try{const raw=localStorage.getItem(BROWSER_STATE_KEY);return raw?JSON.parse(raw):null}catch(e){console.error('browser state local load',e);return null}}

function queueBrowserStateIdb(record){files.browserStatePendingRecord=clone(record);if(files.browserStateWritePromise)return files.browserStateWritePromise;files.browserStateWritePromise=(async()=>{while(files.browserStatePendingRecord){const next=files.browserStatePendingRecord;files.browserStatePendingRecord=null;await idbPut('sync',BROWSER_STATE_IDB_KEY,next)}})().catch(e=>console.error('browser state idb',e)).finally(()=>{files.browserStateWritePromise=null;if(files.browserStatePendingRecord)queueBrowserStateIdb(files.browserStatePendingRecord)});return files.browserStateWritePromise}

function persistImmediateBrowserSnapshot(snapshot=model.state,revision=session.dbRevision,options){const done=beginMeasure('kupa:local-snapshot');try{const record=browserStateRecord(snapshot,revision,options),ok=persistBrowserStateSync(record);queueBrowserStateIdb(record);try{observeStorage(record.state,options)}catch(error){console.error('storage shadow observation',error)}return ok}finally{done()}}

async function loadBrowserState(){const local=loadBrowserStateSync();let idb=null;try{idb=await idbGet('sync',BROWSER_STATE_IDB_KEY)}catch(e){console.error('browser state idb load',e)}const lt=Number(local?.snapshotSeq||0),it=Number(idb?.snapshotSeq||0);session.localSnapshotSeq=Math.max(Number(session.localSnapshotSeq||0),lt,it);const chosen=!local||it>lt?idb:local;if(chosen){persistBrowserStateSync(chosen);queueBrowserStateIdb(chosen)}return chosen||null}

async function requestPersistentBrowserStorage(){try{if(navigator.storage?.persist)await navigator.storage.persist()}catch(e){console.error('persistent storage request',e)}}

return { browserStateRecord, persistBrowserStateSync, loadBrowserStateSync, queueBrowserStateIdb, persistImmediateBrowserSnapshot, loadBrowserState, requestPersistentBrowserStorage };
}

import {comparePendingFreshness} from '../sync/merge-records.js';
import {CLOUD_PENDING_LOCAL_KEY, CLOUD_PENDING_KEY} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStoragePending({session, idbPut, idbGet, idbDelete}){
function loadCloudPendingSync(){try{const raw=localStorage.getItem(CLOUD_PENDING_LOCAL_KEY),pending=raw?JSON.parse(raw):null;if(pending)session.localGeneration=Math.max(session.localGeneration,Number(pending.generation||0));return pending}catch(e){console.error('pending local load',e);return null}}

function persistCloudPendingSync(p){try{const text=JSON.stringify(p);localStorage.setItem(CLOUD_PENDING_LOCAL_KEY,text);if(localStorage.getItem(CLOUD_PENDING_LOCAL_KEY)!==text)throw new Error('אימות pending מקומי נכשל');return true}catch(e){console.error('pending local save',e);return false}}

async function getCloudPending(){let local=loadCloudPendingSync(),idb=null;try{idb=await idbGet('sync',CLOUD_PENDING_KEY)}catch(e){console.error('pending idb load',e)}const chosen=!local?idb:!idb?local:(comparePendingFreshness(local,idb)>=0?local:idb);if(chosen){persistCloudPendingSync(chosen);try{await idbPut('sync',CLOUD_PENDING_KEY,chosen)}catch(e){console.error('pending idb repair',e)}}return chosen||null}

async function putCloudPending(p){const localOk=persistCloudPendingSync(p);try{await idbPut('sync',CLOUD_PENDING_KEY,p);return localOk}catch(e){console.error('pending idb save failed',e);return localOk}}

function cloudPendingExistsSync(){return !!loadCloudPendingSync()}

async function clearCloudPending(maxGeneration=Infinity){const current=await getCloudPending();if(current&&Number(current.generation||0)>Number(maxGeneration))return false;try{localStorage.removeItem(CLOUD_PENDING_LOCAL_KEY)}catch(e){}try{await idbDelete('sync',CLOUD_PENDING_KEY)}catch(e){}return true}

return { loadCloudPendingSync, persistCloudPendingSync, getCloudPending, putCloudPending, cloudPendingExistsSync, clearCloudPending };
}

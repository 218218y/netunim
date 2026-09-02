import {CLOUD_PENDING_LOCAL_KEY, CLOUD_PENDING_KEY} from '../state/constants.js';
import {acknowledgedGenerationMatches,compareOutboxFreshness,migrateOutboxRecord} from '../shared/cloud-sync.js';

const CLOUD_OUTBOX_V3_KEY='cloud-pending-v3';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStoragePending({session, idbPut, idbGet, idbDelete}){
function loadCloudPendingSync(){try{const raw=localStorage.getItem(CLOUD_PENDING_LOCAL_KEY),pending=raw?JSON.parse(raw):null;if(pending)session.localGeneration=Math.max(session.localGeneration,Number(pending.generation||0));return pending}catch(e){console.error('pending local load',e);return null}}

function persistCloudPendingSync(p){try{const text=JSON.stringify(p);localStorage.setItem(CLOUD_PENDING_LOCAL_KEY,text);if(localStorage.getItem(CLOUD_PENDING_LOCAL_KEY)!==text)throw new Error('pending cache verification failed');return true}catch(e){console.error('pending local save',e);return false}}

function migrationDefaults(candidate={}){return {domain:'kupa',documentName:candidate.documentName||session.cloudDocumentName||'main',baseRevision:candidate.baseRevision??session.dbRevision??0,baseState:candidate.baseState||candidate.snapshot||{},snapshot:candidate.snapshot||{},generation:Math.max(1,Number(candidate.generation||session.localGeneration||0))}}

async function getCloudPending(){
  try{await session.cloudOutboxCommitPromise}catch(e){console.error('pending commit',e)}
  const rawLocal=loadCloudPendingSync();let rawV3=null,rawV2=null;
  try{rawV3=await idbGet('sync',CLOUD_OUTBOX_V3_KEY);rawV2=await idbGet('sync',CLOUD_PENDING_KEY)}catch(e){console.error('pending idb load',e)}
  const candidates=[rawLocal,rawV3,rawV2].filter(Boolean).map(value=>migrateOutboxRecord(value,migrationDefaults(value))).filter(Boolean).sort(compareOutboxFreshness);
  const chosen=candidates.at(-1)||null;if(!chosen)return null;
  session.localGeneration=Math.max(session.localGeneration,Number(chosen.generation||0));persistCloudPendingSync(chosen);
  try{await idbPut('sync',CLOUD_OUTBOX_V3_KEY,chosen);if(rawV2)await idbDelete('sync',CLOUD_PENDING_KEY);session.cloudDurabilityDegraded=false}catch(e){session.cloudDurabilityDegraded=true;console.error('pending idb repair',e)}
  return chosen;
}

async function putCloudPending(p){const record=migrateOutboxRecord(p,migrationDefaults(p));if(!record)throw new Error('invalid_outbox_record');let durable=false,idbError=null;try{await idbPut('sync',CLOUD_OUTBOX_V3_KEY,record);durable=true;session.cloudDurabilityDegraded=false}catch(e){idbError=e;session.cloudDurabilityDegraded=true;console.error('pending idb save failed',e)}const localOk=persistCloudPendingSync(record);if(!durable&&!localOk)throw new Error('kupa_outbox_persistence_failed',{cause:idbError});return {record,durable,localOk}}

function cloudPendingExistsSync(){return !!loadCloudPendingSync()}

async function clearCloudPending(acknowledgedGeneration){const current=await getCloudPending();if(!current)return true;if(!acknowledgedGenerationMatches(current,acknowledgedGeneration))return false;try{await idbDelete('sync',CLOUD_OUTBOX_V3_KEY);await idbDelete('sync',CLOUD_PENDING_KEY)}catch(e){console.error('pending idb clear',e);session.cloudDurabilityDegraded=true;return false}try{localStorage.removeItem(CLOUD_PENDING_LOCAL_KEY)}catch(e){console.error('pending cache clear',e);session.cloudDurabilityDegraded=true;return false}session.cloudDurabilityDegraded=false;return true}

return { loadCloudPendingSync, persistCloudPendingSync, getCloudPending, putCloudPending, cloudPendingExistsSync, clearCloudPending };
}

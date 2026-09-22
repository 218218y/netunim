import {stringifyStorage,writeVerifiedStorage} from '../shared/storage-metrics.js';
import {detachLegacyOutbox} from '../shared/spreadsheet-cutover.js';
import {CLOUD_PENDING_LOCAL_KEY, CLOUD_PENDING_KEY} from '../state/constants.js';
import {acknowledgedGenerationMatches,compareOutboxFreshness,migrateOutboxRecord} from '../shared/cloud-sync.js';
import {legacyCardMigrationConflict,migrateLegacyCardPair} from '../sync/legacy-card-migration.js';

const CLOUD_OUTBOX_V3_KEY='cloud-pending-v3';
function normalizeDeleteIntents(value){const out={};if(!value||typeof value!=='object'||Array.isArray(value))return out;for(const [key,ids] of Object.entries(value)){const clean=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort();if(clean.length)out[key]=clean}return out}
export function migrateKupaOutboxRecord(value,migration){
  const record=migrateOutboxRecord(value,migration);if(!record)return record;
  record.deleteIntents=normalizeDeleteIntents(value?.deleteIntents);
  const cards=migrateLegacyCardPair(record.baseState,record.snapshot,{branchLabel:'local'});
  if(cards.conflicts.length){record.conflict=record.conflict||legacyCardMigrationConflict(cards.conflicts);return record}
  record.baseState=cards.base;record.snapshot=cards.branch;
  if(cards.localDeletedIds.length)record.deleteIntents=normalizeDeleteIntents({...record.deleteIntents,cards:[...(record.deleteIntents.cards||[]),...cards.localDeletedIds]});
  return record;
}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStoragePending({externalWorkbooks=false,captureLegacyWorkbook=async()=>{},session, idbPut, idbGet, idbDelete}){
let outboxHeadVerified=false,localPendingReadOk=true;
function invalidateCloudPendingHead(){outboxHeadVerified=false}
globalThis.addEventListener?.('storage',event=>{if(event.key===CLOUD_PENDING_LOCAL_KEY||event.key===null)invalidateCloudPendingHead()});
function loadCloudPendingSync(){if(outboxHeadVerified)return session.cloudOutboxCached||null;try{const raw=localStorage.getItem(CLOUD_PENDING_LOCAL_KEY),pending=raw?JSON.parse(raw):null;localPendingReadOk=true;if(compareOutboxFreshness(session.cloudOutboxCached,pending)>0)return session.cloudOutboxCached;if(pending)session.localGeneration=Math.max(session.localGeneration,Number(pending.generation||0));return pending}catch(e){localPendingReadOk=false;console.error('pending local load',e);return session.cloudOutboxCached||null}}

function persistCloudPendingSync(p){if(Number(session.cloudOutboxCached?.generation||0)>Number(p?.generation||0)||(Number(session.cloudOutboxCached?.generation||0)===Number(p?.generation||0)&&Number(session.cloudOutboxCached?.mutationSeq||0)>Number(p?.mutationSeq||0)))return false;session.cloudOutboxCached=p;outboxHeadVerified=false;try{const text=stringifyStorage('pending',p);writeVerifiedStorage(localStorage,CLOUD_PENDING_LOCAL_KEY,text);return true}catch(e){console.error('pending local save',e);return false}}

function migrationDefaults(candidate={}){return {domain:'kupa',documentName:candidate.documentName||session.cloudDocumentName||'main',baseRevision:candidate.baseRevision??session.dbRevision??0,baseState:candidate.baseState||candidate.snapshot||{},snapshot:candidate.snapshot||{},generation:Math.max(1,Number(candidate.generation||session.localGeneration||0))}}

async function getCloudPending(){
  const observedCommit=session.cloudOutboxCommitPromise;await observedCommit;
  if(session.cloudOutboxCommitPromise!==observedCommit)return getCloudPending();
  if(outboxHeadVerified)return session.cloudOutboxCached||null;
  const rawLocal=loadCloudPendingSync();let rawV3=null,rawV2=null,durableReadOk=false;
  try{rawV3=await idbGet('sync',CLOUD_OUTBOX_V3_KEY);rawV2=await idbGet('sync',CLOUD_PENDING_KEY);durableReadOk=true}catch(e){console.error('pending idb load',e)}
  if(session.cloudOutboxCommitPromise!==observedCommit)return getCloudPending();
  const candidates=[rawLocal,rawV3,rawV2].filter(Boolean).map(value=>migrateKupaOutboxRecord(value,migrationDefaults(value))).filter(Boolean).sort(compareOutboxFreshness);
  let chosen=candidates.at(-1)||null;if(!chosen){session.cloudOutboxCached=null;outboxHeadVerified=localPendingReadOk&&durableReadOk;return null}if(externalWorkbooks)chosen=await detachLegacyOutbox(chosen,captureLegacyWorkbook);
  session.localGeneration=Math.max(session.localGeneration,Number(chosen.generation||0));const cacheOk=persistCloudPendingSync(chosen);let durableOk=false;
  try{await idbPut('sync',CLOUD_OUTBOX_V3_KEY,chosen);if(rawV2)await idbDelete('sync',CLOUD_PENDING_KEY);durableOk=true;session.cloudDurabilityDegraded=false}catch(e){session.cloudDurabilityDegraded=true;console.error('pending idb repair',e)}
  if(session.cloudOutboxCommitPromise!==observedCommit)return getCloudPending();
  outboxHeadVerified=cacheOk&&durableOk;return chosen;
}

async function putCloudPending(p){const record=migrateKupaOutboxRecord(p,migrationDefaults(p));if(!record)throw new Error('invalid_outbox_record');const cachedGeneration=Number(session.cloudOutboxCached?.generation||0),recordGeneration=Number(record.generation||0),cachedSequence=Number(session.cloudOutboxCached?.mutationSeq||0),recordSequence=Number(record.mutationSeq||0);if(cachedGeneration>recordGeneration||(cachedGeneration===recordGeneration&&cachedSequence>recordSequence))return {record:session.cloudOutboxCached,durable:false,localOk:false,superseded:true};const localOk=persistCloudPendingSync(record);let durable=false,idbError=null;try{await idbPut('sync',CLOUD_OUTBOX_V3_KEY,record);durable=true;session.cloudDurabilityDegraded=false}catch(e){idbError=e;session.cloudDurabilityDegraded=true;console.error('pending idb save failed',e)}if(!durable&&!localOk)throw new Error('kupa_outbox_persistence_failed',{cause:idbError});if(compareOutboxFreshness(session.cloudOutboxCached,record)<=0)outboxHeadVerified=localOk&&durable;return {record,durable,localOk}}

function cloudPendingExistsSync(){return outboxHeadVerified?!!session.cloudOutboxCached:!!loadCloudPendingSync()}
function cloudPendingHeadVerifiedCleanSync(){return outboxHeadVerified&&!session.cloudOutboxCached}

async function clearCloudPending(acknowledgedGeneration){
  const current=await getCloudPending();if(!current)return true;
  if(!acknowledgedGenerationMatches(current,acknowledgedGeneration)||Number(loadCloudPendingSync()?.generation||0)>Number(current.generation)||Number(loadCloudPendingSync()?.mutationSeq||0)>Number(current.mutationSeq||0))return false;
  const clearing=(session.cloudOutboxCommitPromise||Promise.resolve()).then(async()=>{
    try{await idbDelete('sync',CLOUD_OUTBOX_V3_KEY);await idbDelete('sync',CLOUD_PENDING_KEY);return true}catch(e){console.error('pending idb clear',e);session.cloudDurabilityDegraded=true;return false}
  });
  session.cloudOutboxCommitPromise=clearing;if(!await clearing)return false;
  if(session.cloudOutboxCommitPromise!==clearing||!acknowledgedGenerationMatches(loadCloudPendingSync(),acknowledgedGeneration))return false;
  try{localStorage.removeItem(CLOUD_PENDING_LOCAL_KEY)}catch(e){console.error('pending cache clear',e);session.cloudDurabilityDegraded=true;return false}
  session.cloudOutboxCached=null;outboxHeadVerified=true;session.cloudDurabilityDegraded=false;return true;
}

return { loadCloudPendingSync, persistCloudPendingSync, getCloudPending, putCloudPending, cloudPendingExistsSync, cloudPendingHeadVerifiedCleanSync, clearCloudPending, invalidateCloudPendingHead };
}

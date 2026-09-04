import {normalizeSharedChecks, normalizeSharedBankEvents} from '../domains/checks/model.js';
import {CHECKS_BASE_KEY, LEGACY_CHECKS_BASE_KEY, CHECKS_EVENTS_KEY, CHECKS_PENDING_KEY, LEGACY_CHECKS_PENDING_KEY, SHARED_CHECKS_DOC} from '../state/constants.js';
import {acknowledgedGenerationMatches,compareOutboxFreshness,createOutboxRecord,migrateOutboxRecord,outboxRetryForGeneration} from '../shared/cloud-sync.js';

const CHECKS_OUTBOX_KEY='shared-checks-outbox-v3';

function normalizeDeleteIds(value){return [...new Set((Array.isArray(value)?value:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort()}
function migrateChecksOutboxRecord(value,migration){const record=migrateOutboxRecord(value,migration);if(record)record.deleteIds=normalizeDeleteIds(value?.deleteIds);return record}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageChecks({checksSession,model,idbPut,idbGet,idbDelete}){
function loadChecksBase(){try{const raw=localStorage.getItem(CHECKS_BASE_KEY)||localStorage.getItem(LEGACY_CHECKS_BASE_KEY),x=JSON.parse(raw||'null');return Array.isArray(x)?normalizeSharedChecks(x):null}catch(e){console.error('checks base load',e);return null}}

function loadChecksBankEvents(){try{return normalizeSharedBankEvents(JSON.parse(localStorage.getItem(CHECKS_EVENTS_KEY)||'[]'))}catch(e){console.error('checks events load',e);return[]}}

function persistChecksBase(checks,events=checksSession.checksBankEvents){try{localStorage.setItem(CHECKS_BASE_KEY,JSON.stringify(normalizeSharedChecks(checks)));localStorage.setItem(CHECKS_EVENTS_KEY,JSON.stringify(normalizeSharedBankEvents(events)));localStorage.removeItem(LEGACY_CHECKS_BASE_KEY);return true}catch(e){console.error('checks base save',e);return false}}

function readPendingCache(){try{const raw=localStorage.getItem(CHECKS_PENDING_KEY)||localStorage.getItem(LEGACY_CHECKS_PENDING_KEY);return JSON.parse(raw||'null')}catch(e){console.error('checks pending cache load',e);return null}}
function writePendingCache(record){try{const text=JSON.stringify(record);localStorage.setItem(CHECKS_PENDING_KEY,text);if(localStorage.getItem(CHECKS_PENDING_KEY)!==text)throw new Error('checks pending verification failed');return true}catch(e){console.error('checks pending cache',e);return false}}

function markChecksPending(snapshot=model.state.checks,message='',conflict=undefined,progress=null){
  const cached=readPendingCache(),canonical=normalizeSharedChecks(snapshot),generation=Math.max(Number(checksSession.checksGeneration||0),Number(cached?.generation||0),1),sameGeneration=!!cached&&Number(cached.generation||0)===generation,advanced=Number(checksSession.checksCloudRevision||0)>Number(cached?.baseRevision||0),base=normalizeSharedChecks(progress?.baseState||(advanced?checksSession.checksCloudBase:cached?.baseState)||checksSession.checksCloudBase||canonical),record=createOutboxRecord({
    domain:'shared-checks',documentName:SHARED_CHECKS_DOC,operationId:sameGeneration?(cached.operationId||cached.id):undefined,
    generation,mutationSeq:Math.max(Number(cached?.mutationSeq||cached?.commitSeq||cached?.generation||0)+1,generation),
    baseRevision:progress?.baseRevision??(advanced?checksSession.checksCloudRevision:cached?.baseRevision??checksSession.checksCloudRevision??0),baseState:base,snapshot:canonical,
    createdAt:cached?.createdAt||cached?.updatedAt,updatedAt:new Date().toISOString(),conflict:conflict===undefined?(cached?.conflict||null):conflict,retry:outboxRetryForGeneration(cached,{sameGeneration,retry:progress?.retry}),mutationType:progress?.mutationType||cached?.mutationType||'autosave',surface:progress?.surface||cached?.surface||'orders.checks',restoreGroupId:progress?.restoreGroupId||cached?.restoreGroupId||null,
  });
  record.deleteIds=normalizeDeleteIds([...(cached?.deleteIds||[]),...(progress?.deleteIds||[])]);
  const cacheOk=writePendingCache(record);checksSession.checksOutboxCached=record;
  const previous=checksSession.checksOutboxCommitPromise||Promise.resolve();
  checksSession.checksOutboxCommitPromise=previous.catch(()=>{}).then(async()=>{
    try{await idbPut(CHECKS_OUTBOX_KEY,record);checksSession.checksDurabilityDegraded=false;return {record,durable:true}}
    catch(error){console.error('checks outbox IndexedDB',error);checksSession.checksDurabilityDegraded=true;if(!cacheOk)throw new Error('checks_outbox_persistence_failed',{cause:error});return {record,durable:false}}
  });
  return cacheOk;
}

async function getChecksPending(){
  try{await checksSession.checksOutboxCommitPromise}catch(e){console.error('checks outbox commit',e)}
  const snapshot=normalizeSharedChecks(model.state.checks),base=normalizeSharedChecks(checksSession.checksCloudBase||loadChecksBase()||snapshot),migration={domain:'shared-checks',documentName:SHARED_CHECKS_DOC,baseRevision:checksSession.checksCloudRevision||0,baseState:base,snapshot,generation:Math.max(1,Number(checksSession.checksGeneration||0))};
  const local=migrateChecksOutboxRecord(readPendingCache(),migration);let durable=null;
  try{const raw=await idbGet(CHECKS_OUTBOX_KEY);durable=migrateChecksOutboxRecord(raw,migration)}catch(e){console.error('checks outbox load',e)}
  const chosen=!local?durable:!durable?local:(compareOutboxFreshness(local,durable)>=0?local:durable);
  if(!chosen){checksSession.checksOutboxCached=null;return null}
  chosen.baseState=normalizeSharedChecks(chosen.baseState);chosen.snapshot=normalizeSharedChecks(chosen.snapshot);
  checksSession.checksOutboxCached=chosen;checksSession.checksGeneration=Math.max(Number(checksSession.checksGeneration||0),Number(chosen.generation||0));writePendingCache(chosen);
  try{await idbPut(CHECKS_OUTBOX_KEY,chosen);checksSession.checksDurabilityDegraded=false}catch(e){checksSession.checksDurabilityDegraded=true;console.error('checks outbox repair',e)}
  return chosen;
}

function checksPendingExists(){return !!(checksSession.checksOutboxCached||localStorage.getItem(CHECKS_PENDING_KEY)||localStorage.getItem(LEGACY_CHECKS_PENDING_KEY))}

async function clearChecksPending(acknowledgedGeneration){const current=await getChecksPending();if(!current)return true;if(!acknowledgedGenerationMatches(current,acknowledgedGeneration))return false;try{await idbDelete(CHECKS_OUTBOX_KEY)}catch(e){console.error('checks outbox clear',e);checksSession.checksDurabilityDegraded=true;return false}try{localStorage.removeItem(CHECKS_PENDING_KEY);localStorage.removeItem(LEGACY_CHECKS_PENDING_KEY)}catch(e){console.error('checks cache clear',e);checksSession.checksDurabilityDegraded=true;return false}checksSession.checksOutboxCached=null;checksSession.checksDurabilityDegraded=false;return true}

return { loadChecksBase, loadChecksBankEvents, persistChecksBase, markChecksPending, getChecksPending, checksPendingExists, clearChecksPending };
}

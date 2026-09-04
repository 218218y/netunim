import {normalizeSharedChecks, normalizeSharedBankEvents} from '../domains/checks/model.js';
import {jsonEq} from './merge-records.js';
import {SHARED_CHECKS_BASE_KEY, SHARED_CHECKS_EVENTS_KEY, SHARED_CHECKS_PENDING_KEY, SHARED_CHECKS_DOC} from '../state/constants.js';
import {acknowledgedGenerationMatches,compareOutboxFreshness,createOutboxRecord,migrateOutboxRecord,outboxRetryForGeneration} from '../shared/cloud-sync.js';

const SHARED_CHECKS_OUTBOX_KEY='shared-checks-outbox-v3';

function normalizeDeleteIds(value){return [...new Set((Array.isArray(value)?value:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort()}
function migrateChecksOutboxRecord(value,migration){const record=migrateOutboxRecord(value,migration);if(record)record.deleteIds=normalizeDeleteIds(value?.deleteIds);return record}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncChecksState({session, checksSession, model, normalizeState, prepareKupaCloudState, idbPut, idbGet, idbDelete}){
function lastSavedState(){try{return session.lastSavedSnapshot?normalizeState(JSON.parse(session.lastSavedSnapshot)):null}catch(e){return null}}
function lastSavedCloudState(){try{return session.lastSavedSnapshot?prepareKupaCloudState(JSON.parse(session.lastSavedSnapshot)):null}catch(e){return null}}
function loadSharedChecksBase(){try{const x=JSON.parse(localStorage.getItem(SHARED_CHECKS_BASE_KEY)||'null');return Array.isArray(x)?normalizeSharedChecks(x):null}catch(e){console.error('shared checks base load',e);return null}}
function loadSharedChecksBankEvents(){try{return normalizeSharedBankEvents(JSON.parse(localStorage.getItem(SHARED_CHECKS_EVENTS_KEY)||'[]'))}catch(e){console.error('shared checks events load',e);return[]}}
function persistSharedChecksBase(checks,events=checksSession.sharedChecksBankEvents){try{localStorage.setItem(SHARED_CHECKS_BASE_KEY,JSON.stringify(normalizeSharedChecks(checks)));localStorage.setItem(SHARED_CHECKS_EVENTS_KEY,JSON.stringify(normalizeSharedBankEvents(events)));return true}catch(e){console.error('shared checks base save',e);return false}}

function readPendingCache(){try{return JSON.parse(localStorage.getItem(SHARED_CHECKS_PENDING_KEY)||'null')}catch(e){console.error('shared checks pending cache load',e);return null}}
function writePendingCache(record){try{const text=JSON.stringify(record);localStorage.setItem(SHARED_CHECKS_PENDING_KEY,text);if(localStorage.getItem(SHARED_CHECKS_PENDING_KEY)!==text)throw new Error('shared checks pending verification failed');return true}catch(e){console.error('shared checks pending cache',e);return false}}

function markSharedChecksPending(snapshot=model.state.checks,message='',conflict=undefined,progress=null){
  const cached=readPendingCache(),canonical=normalizeSharedChecks(snapshot),generation=Math.max(Number(checksSession.sharedChecksGeneration||0),Number(cached?.generation||0),1),sameGeneration=!!cached&&Number(cached.generation||0)===generation,advanced=Number(checksSession.sharedChecksRevision||0)>Number(cached?.baseRevision||0),base=normalizeSharedChecks(progress?.baseState||(advanced?checksSession.sharedChecksBase:cached?.baseState)||checksSession.sharedChecksBase||canonical),record=createOutboxRecord({
    domain:'shared-checks',documentName:SHARED_CHECKS_DOC,operationId:sameGeneration?(cached.operationId||cached.id):undefined,
    generation,mutationSeq:Math.max(Number(cached?.mutationSeq||cached?.commitSeq||cached?.generation||0)+1,generation),baseRevision:progress?.baseRevision??(advanced?checksSession.sharedChecksRevision:cached?.baseRevision??checksSession.sharedChecksRevision??0),baseState:base,snapshot:canonical,
    createdAt:cached?.createdAt||cached?.updatedAt,updatedAt:new Date().toISOString(),conflict:conflict===undefined?(cached?.conflict||null):conflict,retry:outboxRetryForGeneration(cached,{sameGeneration,retry:progress?.retry}),mutationType:progress?.mutationType||cached?.mutationType||'autosave',surface:progress?.surface||cached?.surface||'kupa.checks',restoreGroupId:progress?.restoreGroupId||cached?.restoreGroupId||null,
  });
  record.deleteIds=normalizeDeleteIds([...(cached?.deleteIds||[]),...(progress?.deleteIds||[])]);
  const cacheOk=writePendingCache(record),previous=checksSession.sharedChecksOutboxCommitPromise||Promise.resolve();checksSession.sharedChecksOutboxCached=record;
  checksSession.sharedChecksOutboxCommitPromise=previous.catch(()=>{}).then(async()=>{try{await idbPut('sync',SHARED_CHECKS_OUTBOX_KEY,record);checksSession.sharedChecksDurabilityDegraded=false;return {record,durable:true}}catch(error){checksSession.sharedChecksDurabilityDegraded=true;console.error('shared checks outbox IndexedDB',error);if(!cacheOk)throw new Error('shared_checks_outbox_persistence_failed',{cause:error});return {record,durable:false}}});
  return cacheOk;
}

async function getSharedChecksPending(){
  try{await checksSession.sharedChecksOutboxCommitPromise}catch(e){console.error('shared checks outbox commit',e)}
  const snapshot=normalizeSharedChecks(model.state.checks),base=normalizeSharedChecks(checksSession.sharedChecksBase||loadSharedChecksBase()||snapshot),migration={domain:'shared-checks',documentName:SHARED_CHECKS_DOC,baseRevision:checksSession.sharedChecksRevision||0,baseState:base,snapshot,generation:Math.max(1,Number(checksSession.sharedChecksGeneration||0))};
  const local=migrateChecksOutboxRecord(readPendingCache(),migration);let durable=null;try{const raw=await idbGet('sync',SHARED_CHECKS_OUTBOX_KEY);durable=migrateChecksOutboxRecord(raw,migration)}catch(e){console.error('shared checks outbox load',e)}
  const chosen=!local?durable:!durable?local:(compareOutboxFreshness(local,durable)>=0?local:durable);if(!chosen){checksSession.sharedChecksOutboxCached=null;return null}
  chosen.baseState=normalizeSharedChecks(chosen.baseState);chosen.snapshot=normalizeSharedChecks(chosen.snapshot);checksSession.sharedChecksOutboxCached=chosen;checksSession.sharedChecksGeneration=Math.max(Number(checksSession.sharedChecksGeneration||0),Number(chosen.generation||0));writePendingCache(chosen);
  try{await idbPut('sync',SHARED_CHECKS_OUTBOX_KEY,chosen);checksSession.sharedChecksDurabilityDegraded=false}catch(e){checksSession.sharedChecksDurabilityDegraded=true;console.error('shared checks outbox repair',e)}return chosen;
}

function sharedChecksPendingExists(){return !!(checksSession.sharedChecksOutboxCached||localStorage.getItem(SHARED_CHECKS_PENDING_KEY))}
async function clearSharedChecksPending(acknowledgedGeneration){const current=await getSharedChecksPending();if(!current)return true;if(!acknowledgedGenerationMatches(current,acknowledgedGeneration))return false;try{await idbDelete('sync',SHARED_CHECKS_OUTBOX_KEY)}catch(e){console.error('shared checks outbox clear',e);checksSession.sharedChecksDurabilityDegraded=true;return false}try{localStorage.removeItem(SHARED_CHECKS_PENDING_KEY)}catch(e){console.error('shared checks cache clear',e);checksSession.sharedChecksDurabilityDegraded=true;return false}checksSession.sharedChecksOutboxCached=null;checksSession.sharedChecksDurabilityDegraded=false;return true}
function sharedChecksHaveLocalWork(){return checksSession.sharedChecksSaveRequested||sharedChecksPendingExists()||!!(checksSession.sharedChecksBase&&!jsonEq(normalizeSharedChecks(model.state.checks),normalizeSharedChecks(checksSession.sharedChecksBase)))}

return { lastSavedState, lastSavedCloudState, loadSharedChecksBase, loadSharedChecksBankEvents, persistSharedChecksBase, markSharedChecksPending, getSharedChecksPending, sharedChecksPendingExists, clearSharedChecksPending, sharedChecksHaveLocalWork };
}

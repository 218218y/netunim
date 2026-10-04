import {normalizeSharedChecks, normalizeSharedBankEvents} from '../domains/checks/model.js';
import {jsonEq} from './merge-records.js';
import {SHARED_CHECKS_BASE_KEY, SHARED_CHECKS_EVENTS_KEY, SHARED_CHECKS_PENDING_KEY, SHARED_CHECKS_DOC} from '../state/constants.js';
import {compareOutboxFreshness,migrateOutboxRecord} from '../shared/cloud-sync.js';

const SHARED_CHECKS_OUTBOX_KEY='shared-checks-outbox-v3';

function normalizeDeleteIds(value){return [...new Set((Array.isArray(value)?value:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort()}
function migrateChecksOutboxRecord(value,migration){const record=migrateOutboxRecord(value,migration);if(record)record.deleteIds=normalizeDeleteIds(value?.deleteIds);return record}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createSyncChecksState({session, checksSession, model, normalizeState, prepareKupaCloudState, idbGet, sharedChecksHasLocalWork=()=>true}){
function lastSavedState(){try{return session.lastSavedSnapshot?normalizeState(JSON.parse(session.lastSavedSnapshot)):null}catch(e){return null}}
function lastSavedCloudState(){try{return session.lastSavedSnapshot?prepareKupaCloudState(JSON.parse(session.lastSavedSnapshot)):null}catch(e){return null}}
function loadSharedChecksBase(){try{const x=JSON.parse(localStorage.getItem(SHARED_CHECKS_BASE_KEY)||'null');return Array.isArray(x)?normalizeSharedChecks(x):null}catch(e){console.error('shared checks base load',e);return null}}
function loadSharedChecksBankEvents(){try{return normalizeSharedBankEvents(JSON.parse(localStorage.getItem(SHARED_CHECKS_EVENTS_KEY)||'[]'))}catch(e){console.error('shared checks events load',e);return[]}}
function readPendingCache(){try{return JSON.parse(localStorage.getItem(SHARED_CHECKS_PENDING_KEY)||'null')}catch(e){console.error('shared checks pending cache load',e);return null}}
async function getSharedChecksPending(){
  const observedCommit=checksSession.sharedChecksOutboxCommitPromise;await observedCommit;
  const snapshot=normalizeSharedChecks(model.state.checks),base=normalizeSharedChecks(checksSession.sharedChecksBase||loadSharedChecksBase()||snapshot),migration={domain:'shared-checks',documentName:SHARED_CHECKS_DOC,baseRevision:checksSession.sharedChecksRevision||0,baseState:base,snapshot,generation:Math.max(1,Number(checksSession.sharedChecksGeneration||0))};
  const local=migrateChecksOutboxRecord(readPendingCache(),migration);let durable=null;try{const raw=await idbGet('sync',SHARED_CHECKS_OUTBOX_KEY);durable=migrateChecksOutboxRecord(raw,migration)}catch(e){console.error('shared checks outbox load',e)}
  if(checksSession.sharedChecksOutboxCommitPromise!==observedCommit)return getSharedChecksPending();
  const chosen=!local?durable:!durable?local:(compareOutboxFreshness(local,durable)>=0?local:durable);if(!chosen){checksSession.sharedChecksOutboxCached=null;return null}
  chosen.baseState=normalizeSharedChecks(chosen.baseState);chosen.snapshot=normalizeSharedChecks(chosen.snapshot);checksSession.sharedChecksOutboxCached=chosen;checksSession.sharedChecksGeneration=Math.max(Number(checksSession.sharedChecksGeneration||0),Number(chosen.generation||0));
if(checksSession.sharedChecksOutboxCommitPromise!==observedCommit)return getSharedChecksPending();
  return chosen;
}

function sharedChecksPendingExists(){return !!(checksSession.sharedChecksOutboxCached||localStorage.getItem(SHARED_CHECKS_PENDING_KEY))}
async function verifyLegacyChecksClean(){
  const commit=checksSession.sharedChecksOutboxCommitPromise;await commit;
  const durable=await idbGet('sync',SHARED_CHECKS_OUTBOX_KEY);
  return checksSession.sharedChecksOutboxCommitPromise===commit&&durable==null&&!sharedChecksPendingExists();
}
function sharedChecksHaveLocalWork(){return checksSession.sharedChecksSaveRequested||sharedChecksHasLocalWork()||!!(checksSession.sharedChecksBase&&!jsonEq(normalizeSharedChecks(model.state.checks),normalizeSharedChecks(checksSession.sharedChecksBase)))}

return { lastSavedState, lastSavedCloudState, loadSharedChecksBase, loadSharedChecksBankEvents, getSharedChecksPending, sharedChecksPendingExists, sharedChecksHaveLocalWork, verifyLegacyChecksClean };
}

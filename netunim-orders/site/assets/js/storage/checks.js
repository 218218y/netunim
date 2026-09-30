import {normalizeSharedChecks, normalizeSharedBankEvents} from '../domains/checks/model.js';
import {CHECKS_BASE_KEY, LEGACY_CHECKS_BASE_KEY, CHECKS_EVENTS_KEY, CHECKS_PENDING_KEY, LEGACY_CHECKS_PENDING_KEY, SHARED_CHECKS_DOC} from '../state/constants.js';
import {compareOutboxFreshness,migrateOutboxRecord} from '../shared/cloud-sync.js';

const CHECKS_OUTBOX_KEY='shared-checks-outbox-v3';

function normalizeDeleteIds(value){return [...new Set((Array.isArray(value)?value:[]).map(x=>String(x||'').trim()).filter(Boolean))].sort()}
function migrateChecksOutboxRecord(value,migration){const record=migrateOutboxRecord(value,migration);if(record)record.deleteIds=normalizeDeleteIds(value?.deleteIds);return record}

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageChecks({checksSession,model,idbGet}){
function loadChecksBase(){try{const raw=localStorage.getItem(CHECKS_BASE_KEY)||localStorage.getItem(LEGACY_CHECKS_BASE_KEY),x=JSON.parse(raw||'null');return Array.isArray(x)?normalizeSharedChecks(x):null}catch(e){console.error('checks base load',e);return null}}

function loadChecksBankEvents(){try{return normalizeSharedBankEvents(JSON.parse(localStorage.getItem(CHECKS_EVENTS_KEY)||'[]'))}catch(e){console.error('checks events load',e);return[]}}

function readPendingCache(){try{const raw=localStorage.getItem(CHECKS_PENDING_KEY)||localStorage.getItem(LEGACY_CHECKS_PENDING_KEY);return JSON.parse(raw||'null')}catch(e){console.error('checks pending cache load',e);return null}}
async function getChecksPending(){
  const observedCommit=checksSession.checksOutboxCommitPromise;await observedCommit;
  const snapshot=normalizeSharedChecks(model.state.checks),base=normalizeSharedChecks(checksSession.checksCloudBase||loadChecksBase()||snapshot),migration={domain:'shared-checks',documentName:SHARED_CHECKS_DOC,baseRevision:checksSession.checksCloudRevision||0,baseState:base,snapshot,generation:Math.max(1,Number(checksSession.checksGeneration||0))};
  const local=migrateChecksOutboxRecord(readPendingCache(),migration);let durable=null;
  try{const raw=await idbGet(CHECKS_OUTBOX_KEY);durable=migrateChecksOutboxRecord(raw,migration)}catch(e){console.error('checks outbox load',e)}
  if(checksSession.checksOutboxCommitPromise!==observedCommit)return getChecksPending();
  const chosen=!local?durable:!durable?local:(compareOutboxFreshness(local,durable)>=0?local:durable);
  if(!chosen){checksSession.checksOutboxCached=null;return null}
  chosen.baseState=normalizeSharedChecks(chosen.baseState);chosen.snapshot=normalizeSharedChecks(chosen.snapshot);
  checksSession.checksOutboxCached=chosen;checksSession.checksGeneration=Math.max(Number(checksSession.checksGeneration||0),Number(chosen.generation||0));
  if(checksSession.checksOutboxCommitPromise!==observedCommit)return getChecksPending();
  return chosen;
}

function checksPendingExists(){return !!(checksSession.checksOutboxCached||localStorage.getItem(CHECKS_PENDING_KEY)||localStorage.getItem(LEGACY_CHECKS_PENDING_KEY))}

async function verifyLegacyChecksClean(){
  const commit=checksSession.checksOutboxCommitPromise;await commit;
  const durable=await idbGet(CHECKS_OUTBOX_KEY);
  return checksSession.checksOutboxCommitPromise===commit&&durable==null&&!checksPendingExists();
}

return { loadChecksBase, loadChecksBankEvents, getChecksPending, checksPendingExists, verifyLegacyChecksClean };
}

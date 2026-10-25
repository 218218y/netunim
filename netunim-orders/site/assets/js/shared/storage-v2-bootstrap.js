import {createStorageJournalDb} from './storage-journal-idb.js';
import {assertStorageJson} from './storage-journal-model.js';
import {isHistoricalBootstrapIntent,isHistoricalBootstrapSideIntent,completedHistoricalBootstrapGroup} from './storage-v2-persisted-compat.js';
import {storageJsonHash as sha256} from './storage-json-codec.js';
export {storageV2BootstrapStateHash} from './storage-operation.js';

/** @type {readonly import('./storage-bootstrap-contracts.js').Phase[]} */
export const STORAGE_BOOTSTRAP_PHASES=Object.freeze(['prepared','main-initialized','shared-initialized','main-synced','shared-synced','verified','complete']);
const VALID_APPS=new Set(['orders','kupa']);
/** @type {readonly string[]} */
export const CURRENT_TRANSFER_INTENTS=Object.freeze(['upload-local','load-account','account-switch']);
const NEXT_PHASE=new Map(STORAGE_BOOTSTRAP_PHASES.slice(0,-1).map((phase,index)=>[phase,STORAGE_BOOTSTRAP_PHASES[index+1]||phase]));

/** @template Value @param {Value} value @returns {Value} */
function copy(value){return value==null?value:structuredClone(value)}
/** @param {unknown} value */
function identity(value){const text=String(value||'').trim();if(!text||text.length>512)throw new Error('storage_bootstrap_identity_invalid');return text}
/** @param {unknown} value */
function integer(value){return Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null}
/** @param {unknown} value */
function validHash(value){return /^[0-9a-f]{64}$/.test(String(value||''))}
/** @param {import('./storage-json.js').StorageJson|undefined} value @returns {import('./storage-bootstrap-contracts.js').Side} */
function validateSide(value){
  const side=value!==null&&typeof value==='object'&&!Array.isArray(value)?value:null;
  if(!side||(typeof side.role!=='string'||!['main','shared'].includes(side.role))||!(typeof side.intent==='string'&&['cloud-authoritative','upload-local'].includes(side.intent)||isHistoricalBootstrapSideIntent(side.intent))||integer(side.sourceSeq)===null||!validHash(side.sourceHash)||!String(side.operationId||'').trim())throw new Error('storage_bootstrap_side_invalid');
  if(side.intent==='cloud-authoritative'){
    if(side.remoteExists!==true||integer(side.remoteRevision)===null||!validHash(side.remoteHash))throw new Error('storage_bootstrap_remote_invalid');
  }else if(side.remoteExists!==false||side.remoteRevision!==0||side.remoteHash!==null)throw new Error('storage_bootstrap_upload_target_invalid');
  return /** @type {import('./storage-bootstrap-contracts.js').Side} */ (side);
}
/** @typedef {import('./storage-bootstrap-contracts.js').Group} Group */
/** @template Value @param {Value} value @returns {Value & Group} */
export function assertStorageV2BootstrapGroup(value){
  const data=assertStorageJson(value),group=data!==null&&typeof data==='object'&&!Array.isArray(data)?data:null;
  if(!group||group.version!==2||typeof group.app!=='string'||!VALID_APPS.has(group.app)||
    group.scope!==`${group.app}:${group.owner}`||!String(group.id||'').trim()||!identity(group.owner)||!identity(group.sourceOwner)||
    !(typeof group.transferIntent==='string'&&CURRENT_TRANSFER_INTENTS.includes(group.transferIntent)||isHistoricalBootstrapIntent(group.transferIntent))||
    !STORAGE_BOOTSTRAP_PHASES.some(phase=>phase===group.phase)||!validHash(group.planHash)||
    !String(group.createdAt||'').trim()||!String(group.updatedAt||'').trim())throw new Error('storage_bootstrap_group_invalid');
  validateSide(group.main);validateSide(group.shared);
  return /** @type {Value & Group} */ (value);
}
/** @param {'main'|'shared'} role @param {import('./storage-json.js').StorageJsonObject} state */
function authoritativeSideState(role,state){
  if(role!=='shared')return state;
  if(!state||!Array.isArray(state.checks)||!Array.isArray(state.bankEvents))throw new Error('storage_bootstrap_shared_state_invalid');
  // Shared Checks cloud documents may carry transport/schema metadata (for
  // example `version`). Ownership/parity is defined only by the authoritative
  // journal projection, never by envelope fields.
  return {checks:state.checks,bankEvents:state.bankEvents};
}

/** @param {'main'|'shared'} role @param {import('./storage-bootstrap-contracts.js').Source|undefined} source @param {import('./storage-bootstrap-contracts.js').Remote|null} remote @param {string} id @param {import('./storage-bootstrap-contracts.js').CryptoPort} cryptoImpl @param {'upload-local'|null} uploadIntent */
async function sidePlan(role,source,remote,id,cryptoImpl,uploadIntent){
  if(!source?.state||typeof source.state!=='object'||Array.isArray(source.state)||integer(source.seq)===null)throw new Error('storage_bootstrap_source_invalid');
  const exists=remote!==null&&remote!==undefined;
  if(exists&&(!remote.state||typeof remote.state!=='object'||Array.isArray(remote.state)||integer(remote.revision)===null))throw new Error('storage_bootstrap_remote_invalid');
  if(!exists&&uploadIntent!=='upload-local')throw new Error(`storage_bootstrap_${role}_remote_missing`);
  return {
    role,
    intent:exists?'cloud-authoritative':uploadIntent,
    sourceSeq:Number(source.seq),
    sourceHash:await sha256(authoritativeSideState(role,source.state),cryptoImpl),
    remoteExists:exists,
    remoteRevision:exists?Number(remote.revision):0,
    remoteHash:exists?await sha256(authoritativeSideState(role,remote.state),cryptoImpl):null,
    operationId:`${id}:${role}`,
  };
}

// A bootstrap group freezes the decision about both cloud documents before any
// initialization starts. Existing documents are always cloud-authoritative;
// only an actually missing document can receive upload-local.
/** @param {Partial<import('./storage-bootstrap-contracts.js').PlanOptions>} [options] */
export async function createStorageV2BootstrapGroup({app,owner,sourceOwner='local',transferIntent,mainSource,sharedSource,mainRemote=null,sharedRemote=null,id=null,now=()=>new Date().toISOString(),cryptoImpl=globalThis.crypto}={}){
  const site=String(app||'').trim();if(site!=='orders'&&site!=='kupa')throw new Error('storage_bootstrap_app_invalid');
  const target=identity(owner),source=identity(sourceOwner),transfer=String(transferIntent||'').trim(),groupId=String(id||cryptoImpl?.randomUUID?.()||'').trim();if(!groupId)throw new Error('storage_bootstrap_id_unavailable');
  if(!CURRENT_TRANSFER_INTENTS.includes(transfer))throw new Error('storage_bootstrap_transfer_intent_required');
  if(transfer==='upload-local'&&source!=='local')throw new Error('storage_bootstrap_source_owner_invalid');
  if(transfer==='load-account'&&source!=='local')throw new Error('storage_bootstrap_source_owner_invalid');
  if(transfer==='account-switch'&&(source==='local'||source===target))throw new Error('storage_bootstrap_source_owner_invalid');
  if(transfer==='upload-local'&&mainRemote)throw new Error('storage_bootstrap_upload_target_exists');
  if(['load-account','account-switch'].includes(transfer)&&!mainRemote)throw new Error('storage_bootstrap_main_remote_missing');
  const uploadIntent=transfer==='upload-local'?/** @type {const} */('upload-local'):null;
  const main=await sidePlan('main',mainSource,mainRemote,groupId,cryptoImpl,uploadIntent),shared=await sidePlan('shared',sharedSource,sharedRemote,groupId,cryptoImpl,uploadIntent),createdAt=String(typeof now==='function'?now():now);
  if(shared.remoteExists&&transfer==='upload-local'&&shared.sourceHash!==shared.remoteHash)throw new Error('storage_bootstrap_shared_reconciliation_required');
  const planHash=await sha256({app:site,owner:target,sourceOwner:source,transferIntent:transfer,main,shared},cryptoImpl);
  return assertStorageV2BootstrapGroup({version:2,scope:`${site}:${target}`,id:groupId,app:site,owner:target,sourceOwner:source,transferIntent:transfer,phase:'prepared',planHash,main,shared,createdAt,updatedAt:createdAt});
}

/** @param {Partial<import('./storage-bootstrap-contracts.js').CoordinatorOptions>} [options] */
export function createStorageV2BootstrapCoordinator({app,owner:configuredOwner,primary=()=>true,db=createStorageJournalDb(),now=()=>new Date().toISOString(),cryptoImpl=globalThis.crypto,operationId=()=>cryptoImpl?.randomUUID?.()}={}){
  const configuredSite=String(app||'').trim();if((configuredSite!=='orders'&&configuredSite!=='kupa')||typeof configuredOwner!=='function'||typeof primary!=='function')throw new Error('storage_bootstrap_configuration');
  const site=configuredSite,owner=configuredOwner;
  /** @type {Group|null} */ let cached=null;
  let hydrated=false;
  const scope=()=>`${site}:${identity(owner())}`;
  /** @param {string} scoped */
  const sameScope=scoped=>{if(scope()!==scoped)throw new Error('storage_bootstrap_owner_changed')};
  /** @param {string} scoped */
  const guard=scoped=>{if(!primary())throw new Error('storage_bootstrap_primary_required');sameScope(scoped)};
  /** @overload @param {import('./storage-json.js').StorageJsonObject} group @returns {Group} */
  /** @overload @param {unknown} group @returns {Group|null} */
  /** @param {unknown} group */
  function remember(group){hydrated=true;cached=group?assertStorageV2BootstrapGroup(group):null;return cached&&copy(cached)}
  async function load(){const scoped=scope();const group=await db.readBootstrapGroup(scoped);sameScope(scoped);return remember(group)}
  /** @param {import('./storage-bootstrap-contracts.js').PrepareOptions} options */
  async function prepare(options){
    const scoped=scope();guard(scoped);const target=identity(owner()),existing=await db.readBootstrapGroup(scoped);guard(scoped);
    if(existing){
      const durable=assertStorageV2BootstrapGroup(existing);
      if(completedHistoricalBootstrapGroup(durable)){
        const next=await createStorageV2BootstrapGroup({app:site,owner:target,id:operationId(),now,cryptoImpl,...options});guard(scoped);
        const replaced=await db.beginBootstrapGroup(scoped,next);guard(scoped);return remember(replaced);
      }
      // Re-discovery after a crash is allowed only when it describes exactly the
      // same frozen plan. Reuse the durable group id so operation ids stay stable.
      const candidate=await createStorageV2BootstrapGroup({app:site,owner:target,id:durable.id,now:()=>durable.createdAt,cryptoImpl,...options});guard(scoped);
      if(durable.phase!=='complete'){
        if(candidate.planHash!==durable.planHash)throw new Error('storage_bootstrap_group_pending');
        return remember(durable);
      }
      // A completed group is historical proof, not a permanent reservation for
      // this owner. Reuse it only while the entire immutable plan is identical.
      // A later account handoff/cutover with different source or remote heads gets
      // a fresh operation id and durable group instead of trusting stale proof.
      if(candidate.planHash===durable.planHash)return remember(durable);
      const next=await createStorageV2BootstrapGroup({app:site,owner:target,id:operationId(),now,cryptoImpl,...options});guard(scoped);
      const replaced=await db.beginBootstrapGroup(scoped,next);guard(scoped);return remember(replaced);
    }
    const group=await createStorageV2BootstrapGroup({app:site,owner:target,id:operationId(),now,cryptoImpl,...options});guard(scoped);
    const durable=await db.beginBootstrapGroup(scoped,group);guard(scoped);return remember(durable);
  }
  /** @param {import('./storage-bootstrap-contracts.js').Phase} expectedPhase @param {import('./storage-json.js').StorageJsonObject} [details] @param {import('./storage-bootstrap-contracts.js').Expected|null} [expectedGroup] */
  async function advance(expectedPhase,details={},expectedGroup=null){
    const scoped=scope();guard(scoped);const record=await db.readBootstrapGroup(scoped);guard(scoped);if(!record)throw new Error('storage_bootstrap_group_missing');const current=assertStorageV2BootstrapGroup(record);
    if(completedHistoricalBootstrapGroup(current))throw new Error('storage_bootstrap_historical_incomplete');
    if(expectedGroup&&(expectedGroup.scope!==scoped||expectedGroup.id!==current.id||expectedGroup.planHash!==current.planHash))throw new Error('storage_bootstrap_group_changed');
    const next=NEXT_PHASE.get(expectedPhase);if(!next||current.phase!==expectedPhase)throw new Error('storage_bootstrap_phase_invalid');
    const updated=await db.advanceBootstrapGroup(scoped,current.id,expectedPhase,next,{...copy(details),updatedAt:String(typeof now==='function'?now():now)});guard(scoped);return remember(updated);
  }
  return {load,prepare,advance,get phases(){return STORAGE_BOOTSTRAP_PHASES},get ready(){return hydrated},get hasGroup(){return !!cached},get group(){return cached&&copy(cached)}};
}

// Executes the durable group one idempotent phase at a time. Application
// callbacks must verify an already-completed side effect before returning, so
// a crash between the effect and advance() can safely repeat only that phase.
/** @param {Partial<import('./storage-bootstrap-contracts.js').ExecutorOptions>} [options] */
export function createStorageV2BootstrapExecutor({coordinator:configuredCoordinator,primary=()=>true,initializeMain:configuredMain,initializeShared:configuredShared,syncMain:configuredSyncMain,syncShared:configuredSyncShared,verify:configuredVerify}={}){
  if(!configuredCoordinator||typeof configuredCoordinator.load!=='function'||typeof configuredCoordinator.prepare!=='function'||typeof configuredCoordinator.advance!=='function'||typeof primary!=='function'||typeof configuredMain!=='function'||typeof configuredShared!=='function'||typeof configuredSyncMain!=='function'||typeof configuredSyncShared!=='function'||typeof configuredVerify!=='function')throw new Error('storage_bootstrap_executor_configuration');
  const coordinator=configuredCoordinator,initializeMain=configuredMain,initializeShared=configuredShared,syncMain=configuredSyncMain,syncShared=configuredSyncShared,verify=configuredVerify;
  /** @type {Promise<Group|null>|null} */ let running=null;
  const guard=()=>{if(!primary())throw new Error('storage_bootstrap_primary_required')};
  /** @param {Group} group */
  async function execute(group){
    /** @type {Group|null} */ let current=group;
    const expected={scope:group.scope,id:group.id,planHash:group.planHash};
    const advance=(/** @type {import('./storage-bootstrap-contracts.js').Phase} */ phase,/** @type {import('./storage-json.js').StorageJsonObject} */ details={})=>coordinator.advance(phase,details,expected);
    while(current){
      guard();
      if(completedHistoricalBootstrapGroup(current))return current;
      if(current.phase==='prepared'){
        const proof=await initializeMain(copy(current.main),copy(current));guard();current=await advance('prepared',{mainProof:copy(proof)});continue;
      }
      if(current.phase==='main-initialized'){
        const proof=await initializeShared(copy(current.shared),copy(current));guard();current=await advance('main-initialized',{sharedProof:copy(proof)});continue;
      }
      if(current.phase==='shared-initialized'){
        const proof=await syncMain(copy(current.main),copy(current));guard();current=await advance('shared-initialized',{mainSyncProof:copy(proof)});continue;
      }
      if(current.phase==='main-synced'){
        const proof=await syncShared(copy(current.shared),copy(current));guard();current=await advance('main-synced',{sharedSyncProof:copy(proof)});continue;
      }
      if(current.phase==='shared-synced'){
        const proof=await verify(copy(current));guard();current=await advance('shared-synced',{verificationProof:copy(proof)});continue;
      }
      if(current.phase==='verified'){current=await advance('verified');continue}
      if(current.phase==='complete')return current;
      throw new Error('storage_bootstrap_phase_invalid');
    }
    throw new Error('storage_bootstrap_group_missing');
  }
  async function resume(){
    if(running)return running;
    running=(async()=>{guard();const group=await coordinator.load();if(!group)return null;return execute(group)})().finally(()=>{running=null});return running;
  }
  /** @param {import('./storage-bootstrap-contracts.js').PrepareOptions} options */
  async function start(options){
    if(running)return running;
    running=(async()=>{guard();const group=await coordinator.prepare(options);return execute(group)})().finally(()=>{running=null});return running;
  }
  return {start,resume};
}

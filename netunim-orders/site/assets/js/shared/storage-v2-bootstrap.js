import {createStorageJournalDb} from './storage-journal-idb.js';
import {assertStorageJson} from './storage-journal-model.js';

export const STORAGE_BOOTSTRAP_PHASES=Object.freeze(['prepared','main-initialized','shared-initialized','main-synced','shared-synced','verified','complete']);
const VALID_APPS=new Set(['orders','kupa']);
const TRANSFER_INTENTS=new Set(['upload-local','load-account','account-switch','first-cloud','legacy-upgrade']);
const NEXT_PHASE=new Map(STORAGE_BOOTSTRAP_PHASES.slice(0,-1).map((phase,index)=>[phase,STORAGE_BOOTSTRAP_PHASES[index+1]]));

function copy(value){return value==null?value:structuredClone(value)}
function identity(value){const text=String(value||'').trim();if(!text||text.length>512)throw new Error('storage_bootstrap_identity_invalid');return text}
function integer(value){return Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null}
function canonicalJson(value){
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function sha256(value,cryptoImpl=globalThis.crypto){
  if(!cryptoImpl?.subtle?.digest)throw new Error('storage_bootstrap_sha256_unavailable');
  const bytes=new TextEncoder().encode(canonicalJson(value)),digest=await cryptoImpl.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function validHash(value){return /^[0-9a-f]{64}$/.test(String(value||''))}
function validateSide(side){
  if(!side||!['main','shared'].includes(side.role)||!['cloud-authoritative','upload-local','upload-owner'].includes(side.intent)||integer(side.sourceSeq)===null||!validHash(side.sourceHash)||!String(side.operationId||'').trim())throw new Error('storage_bootstrap_side_invalid');
  if(side.intent==='cloud-authoritative'){
    if(side.remoteExists!==true||integer(side.remoteRevision)===null||!validHash(side.remoteHash))throw new Error('storage_bootstrap_remote_invalid');
  }else if(side.remoteExists!==false||side.remoteRevision!==0||side.remoteHash!==null)throw new Error('storage_bootstrap_upload_target_invalid');
  return side;
}
export function assertStorageV2BootstrapGroup(group){
  assertStorageJson(group);
  if(!group||group.version!==2||!VALID_APPS.has(group.app)||group.scope!==`${group.app}:${group.owner}`||!String(group.id||'').trim()||!identity(group.owner)||!identity(group.sourceOwner)||!TRANSFER_INTENTS.has(group.transferIntent)||!STORAGE_BOOTSTRAP_PHASES.includes(group.phase)||!validHash(group.planHash)||!String(group.createdAt||'').trim()||!String(group.updatedAt||'').trim())throw new Error('storage_bootstrap_group_invalid');
  validateSide(group.main);validateSide(group.shared);
  return group;
}
function authoritativeSideState(role,state){
  if(role!=='shared')return state;
  if(!state||!Array.isArray(state.checks)||!Array.isArray(state.bankEvents))throw new Error('storage_bootstrap_shared_state_invalid');
  // Shared Checks cloud documents may carry transport/schema metadata (for
  // example `version`). Ownership/parity is defined only by the authoritative
  // journal projection, never by envelope fields.
  return {checks:state.checks,bankEvents:state.bankEvents};
}

export function storageV2BootstrapStateHash(role,state,{cryptoImpl=globalThis.crypto}={}){
  if(!['main','shared'].includes(role))throw new Error('storage_bootstrap_role_invalid');
  return sha256(authoritativeSideState(role,state),cryptoImpl);
}
async function sidePlan(role,source,remote,id,cryptoImpl,uploadIntent){
  if(!source?.state||typeof source.state!=='object'||Array.isArray(source.state)||integer(source.seq)===null)throw new Error('storage_bootstrap_source_invalid');
  const exists=remote!==null&&remote!==undefined;
  if(exists&&(!remote.state||typeof remote.state!=='object'||Array.isArray(remote.state)||integer(remote.revision)===null))throw new Error('storage_bootstrap_remote_invalid');
  if(!exists&&!['upload-local','upload-owner'].includes(uploadIntent))throw new Error(`storage_bootstrap_${role}_remote_missing`);
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
export async function createStorageV2BootstrapGroup({app,owner,sourceOwner='local',transferIntent,mainSource,sharedSource,mainRemote=null,sharedRemote=null,id=null,now=()=>new Date().toISOString(),cryptoImpl=globalThis.crypto}={}){
  const site=String(app||'').trim();if(!VALID_APPS.has(site))throw new Error('storage_bootstrap_app_invalid');
  const target=identity(owner),source=identity(sourceOwner),transfer=String(transferIntent||'').trim(),groupId=String(id||cryptoImpl?.randomUUID?.()||'').trim();if(!groupId)throw new Error('storage_bootstrap_id_unavailable');
  if(!TRANSFER_INTENTS.has(transfer))throw new Error('storage_bootstrap_transfer_intent_required');
  if(transfer==='upload-local'&&source!=='local')throw new Error('storage_bootstrap_source_owner_invalid');
  if(['first-cloud','legacy-upgrade'].includes(transfer)&&source!==target)throw new Error('storage_bootstrap_source_owner_invalid');
  if(transfer==='load-account'&&source!=='local')throw new Error('storage_bootstrap_source_owner_invalid');
  if(transfer==='account-switch'&&(source==='local'||source===target))throw new Error('storage_bootstrap_source_owner_invalid');
  if(transfer==='upload-local'&&mainRemote)throw new Error('storage_bootstrap_upload_target_exists');
  if(['load-account','account-switch'].includes(transfer)&&!mainRemote)throw new Error('storage_bootstrap_main_remote_missing');
  const uploadIntent=transfer==='upload-local'?'upload-local':['first-cloud','legacy-upgrade'].includes(transfer)?'upload-owner':null;
  const main=await sidePlan('main',mainSource,mainRemote,groupId,cryptoImpl,uploadIntent),shared=await sidePlan('shared',sharedSource,sharedRemote,groupId,cryptoImpl,uploadIntent),createdAt=String(typeof now==='function'?now():now);
  // During an in-place migration the V1 head was just drained. Therefore an
  // already-existing cloud document must be exactly the source we are freezing.
  // Treating a divergent remote Main as authoritative here would create a V2
  // checkpoint whose visible state differs from its cloud base without a pending
  // operation, silently dropping the local delta. Account load/switch are
  // intentionally excluded: their remote document is the requested authority.
  if(main.remoteExists&&['first-cloud','legacy-upgrade'].includes(transfer)&&main.sourceHash!==main.remoteHash)throw new Error('storage_bootstrap_main_reconciliation_required');
  if(shared.remoteExists&&['upload-local','first-cloud','legacy-upgrade'].includes(transfer)&&shared.sourceHash!==shared.remoteHash)throw new Error('storage_bootstrap_shared_reconciliation_required');
  const planHash=await sha256({app:site,owner:target,sourceOwner:source,transferIntent:transfer,main,shared},cryptoImpl);
  return assertStorageV2BootstrapGroup({version:2,scope:`${site}:${target}`,id:groupId,app:site,owner:target,sourceOwner:source,transferIntent:transfer,phase:'prepared',planHash,main,shared,createdAt,updatedAt:createdAt});
}

export function createStorageV2BootstrapCoordinator({app,owner,primary=()=>true,db=createStorageJournalDb(),now=()=>new Date().toISOString(),cryptoImpl=globalThis.crypto,operationId=()=>cryptoImpl?.randomUUID?.()}={}){
  const site=String(app||'').trim();if(!VALID_APPS.has(site)||typeof owner!=='function'||typeof primary!=='function')throw new Error('storage_bootstrap_configuration');
  let hydrated=false,cached=null;
  const scope=()=>`${site}:${identity(owner())}`;
  const sameScope=scoped=>{if(scope()!==scoped)throw new Error('storage_bootstrap_owner_changed')};
  const guard=scoped=>{if(!primary())throw new Error('storage_bootstrap_primary_required');sameScope(scoped)};
  const remember=group=>{hydrated=true;cached=group?assertStorageV2BootstrapGroup(group):null;return cached&&copy(cached)};
  async function load(){const scoped=scope();const group=await db.readBootstrapGroup(scoped);sameScope(scoped);return remember(group)}
  async function prepare(options={}){
    const scoped=scope();guard(scoped);const target=identity(owner()),existing=await db.readBootstrapGroup(scoped);guard(scoped);
    if(existing){
      const durable=assertStorageV2BootstrapGroup(existing);
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
  async function advance(expectedPhase,details={}){
    const scoped=scope();guard(scoped);const current=await db.readBootstrapGroup(scoped);guard(scoped);if(!current)throw new Error('storage_bootstrap_group_missing');assertStorageV2BootstrapGroup(current);
    const next=NEXT_PHASE.get(expectedPhase);if(!next||current.phase!==expectedPhase)throw new Error('storage_bootstrap_phase_invalid');
    const updated=await db.advanceBootstrapGroup(scoped,current.id,expectedPhase,next,{...copy(details),updatedAt:String(typeof now==='function'?now():now)});guard(scoped);return remember(updated);
  }
  return {load,prepare,advance,get phases(){return STORAGE_BOOTSTRAP_PHASES},get ready(){return hydrated},get hasGroup(){return !!cached},get group(){return cached&&copy(cached)}};
}

// Executes the durable group one idempotent phase at a time. Application
// callbacks must verify an already-completed side effect before returning, so
// a crash between the effect and advance() can safely repeat only that phase.
export function createStorageV2BootstrapExecutor({coordinator,primary=()=>true,initializeMain,initializeShared,syncMain,syncShared,verify}={}){
  if(!coordinator||typeof coordinator.load!=='function'||typeof coordinator.prepare!=='function'||typeof coordinator.advance!=='function'||[primary,initializeMain,initializeShared,syncMain,syncShared,verify].some(fn=>typeof fn!=='function'))throw new Error('storage_bootstrap_executor_configuration');
  let running=null;
  const guard=()=>{if(!primary())throw new Error('storage_bootstrap_primary_required')};
  async function execute(group){
    let current=group;
    while(current){
      guard();
      if(current.phase==='prepared'){
        const proof=await initializeMain(copy(current.main),copy(current));guard();current=await coordinator.advance('prepared',{mainProof:copy(proof)});continue;
      }
      if(current.phase==='main-initialized'){
        const proof=await initializeShared(copy(current.shared),copy(current));guard();current=await coordinator.advance('main-initialized',{sharedProof:copy(proof)});continue;
      }
      if(current.phase==='shared-initialized'){
        const proof=await syncMain(copy(current.main),copy(current));guard();current=await coordinator.advance('shared-initialized',{mainSyncProof:copy(proof)});continue;
      }
      if(current.phase==='main-synced'){
        const proof=await syncShared(copy(current.shared),copy(current));guard();current=await coordinator.advance('main-synced',{sharedSyncProof:copy(proof)});continue;
      }
      if(current.phase==='shared-synced'){
        const proof=await verify(copy(current));guard();current=await coordinator.advance('shared-synced',{verificationProof:copy(proof)});continue;
      }
      if(current.phase==='verified'){current=await coordinator.advance('verified');continue}
      if(current.phase==='complete')return current;
      throw new Error('storage_bootstrap_phase_invalid');
    }
    throw new Error('storage_bootstrap_group_missing');
  }
  async function resume(){
    if(running)return running;
    running=(async()=>{guard();const group=await coordinator.load();if(!group)return null;return execute(group)})().finally(()=>{running=null});return running;
  }
  async function start(options={}){
    if(running)return running;
    running=(async()=>{guard();const group=await coordinator.prepare(options);return execute(group)})().finally(()=>{running=null});return running;
  }
  return {start,resume};
}

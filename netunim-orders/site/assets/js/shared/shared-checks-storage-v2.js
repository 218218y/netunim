import {readSharedChecksState,readStorageState} from './storage-operation.js';
import {createStorageJournal} from './storage-journal.js';
import {createStorageJournalDb} from './storage-journal-idb.js';
import {readStorageCheckpoint} from './storage-checkpoint.js';
import {equalSyncJson} from './cloud-sync.js';
import {SHARED_CHECKS_STORAGE_SCHEMA as SCHEMA} from './storage-v2-schema.js';


export const validateSharedChecksState=readSharedChecksState;

/** @param {unknown} state */
function canonicalState(state){const verified=validateSharedChecksState(state);return {checks:structuredClone(verified.checks),bankEvents:structuredClone(verified.bankEvents)}}

// Shared Checks has its own cloud revision, so it must never share the main
// document's cursor or flight. The caller owns the business merge and RPC;
// this store owns local durability and the exact pending cloud payload.
/** @typedef {import('./shared-checks-storage-contracts.js').Methods} Methods */
/** @param {Partial<import('./shared-checks-storage-contracts.js').Options>} [options] */
export function createSharedChecksStorageV2({owner:configuredOwner,primary:configuredPrimary,commitPrimary=configuredPrimary,role='primary',validate=validateSharedChecksState,createJournal=createStorageJournal,db,emergency,operationId,now}={}){
  if(typeof configuredOwner!=='function'||typeof configuredPrimary!=='function'||typeof commitPrimary!=='function')throw new Error('shared_checks_storage_configuration');
  const owner=configuredOwner,primary=configuredPrimary,commitAuthority=commitPrimary;
  if(role!=='primary')throw new Error('shared_checks_storage_role_invalid');
  const identity=String(owner()||'').trim();
  if(!identity)throw new Error('shared_checks_owner_required');
  const scopedOwner=`${identity}:shared-checks`,database=db||createStorageJournalDb();
  const journal=createJournal({owner:scopedOwner,schema:SCHEMA,validate,
    primary:()=>primary()&&String(owner()||'').trim()===identity,commitPrimary:()=>commitAuthority()&&String(owner()||'').trim()===identity,db:database,...(emergency===undefined?{}:{emergency}),...(operationId===undefined?{}:{operationId}),...(now===undefined?{}:{now})});
  let trusted=false;
  const assertOwner=()=>{if(!primary())throw new Error('storage_secondary_tab');if(String(owner()||'').trim()!==identity)throw new Error('shared_checks_owner_changed')};
  const assertTrusted=()=>{assertOwner();if(!trusted)throw new Error('shared_checks_storage_not_open')};
  const assertCloudWriter=()=>assertTrusted();

  /** @type {Methods['recoverReadOnly']} */
  async function recoverReadOnly(){
    if(String(owner()||'').trim()!==identity)throw new Error('shared_checks_owner_changed');
    const stored=await database.load(scopedOwner);
    if(stored.checkpoints&&readStorageCheckpoint(stored.checkpoints).appMetadata?.storageRole!=='shared-checks-primary')throw new Error('shared_checks_storage_role_mismatch');
    const recovered=await journal.recover();
    if(String(owner()||'').trim()!==identity)throw new Error('shared_checks_owner_changed');
    if(recovered?.appMetadata?.storageRole!=='shared-checks-primary')throw new Error('shared_checks_storage_role_mismatch');
    return recovered;
  }
  /** @type {Methods['open']} */
  async function open({migrationState=null,migrationIntent=null,sourceOwner=null}={}){
    assertOwner();const stored=await database.load(scopedOwner);
    if(stored.checkpoints&&readStorageCheckpoint(stored.checkpoints).appMetadata?.storageRole!=='shared-checks-primary')throw new Error('shared_checks_storage_role_mismatch');
    const recovered=await journal.open();
    if(recovered){if(recovered.appMetadata?.storageRole!=='shared-checks-primary')throw new Error('shared_checks_storage_role_mismatch');trusted=true;return recovered}
    if(migrationState===null)return null;
    const source=String(sourceOwner||'').trim(),sameOwner=source===identity;
    if(!sameOwner||migrationIntent!=='cloud-authoritative'&&!(identity==='local'&&migrationIntent==='local-birth'))throw new Error('shared_checks_owner_transfer_intent_required');
    validate(readStorageState(migrationState));
    await journal.install(canonicalState(migrationState),{expectedEpoch:null,appMetadata:{storageRole:'shared-checks-primary',migrationIntent,sourceOwner:source}});
    trusted=true;return journal.recover();
  }
  /** @type {Methods['initializeCloudHead']} */
  async function initializeCloudHead(revision,state,options){
    const {intent,sourceOwner,bootstrapOperationId=''}=options||{};
    assertOwner();
    const source=String(sourceOwner||'').trim(),canonical=canonicalState(state);
    const validIntent=(intent==='upload-local'&&source==='local')||(intent==='cloud-authoritative'&&source===identity);
    if(!validIntent)throw new Error('shared_checks_owner_transfer_intent_required');
    const bootstrap=intent==='upload-local';
    if(bootstrap&&(revision!==0||canonical.bankEvents.length))throw new Error('shared_checks_bootstrap_invalid');
    const initial=bootstrap?{checks:[],bankEvents:[]}:canonical;
    /** @type {import('./storage-records.js').StorageChange[]|null} */
    const changes=bootstrap?[{type:'set',field:'bankEvents',value:[]},...canonical.checks.map((record,index)=>({type:/** @type {const} */('put'),collection:'checks',id:record.id,mode:/** @type {const} */('insert'),index,record}))]:null;
    const metadata={storageRole:'shared-checks-primary',migrationIntent:intent,sourceOwner:source,bootstrapOperationId:String(bootstrapOperationId||'')};let recovered;
    try{recovered=await journal.initializeCloudHead(revision,initial,{changes,appMetadata:metadata})}
    catch(error){
      if(!(error instanceof Error)||error.message!=='storage_initialization_exists'||!metadata.bootstrapOperationId)throw error;
      const existing=await journal.open(),cloud=await journal.cloudState();
      const idempotent=!!existing&&existing.appMetadata?.bootstrapOperationId===metadata.bootstrapOperationId&&existing.appMetadata?.migrationIntent===intent&&existing.appMetadata?.sourceOwner===source&&cloud?.base?.revision===revision&&equalSyncJson(existing.state,canonical);
      if(idempotent)recovered=existing;
      else throw new Error('shared_checks_bootstrap_existing_head_mismatch');
    }
    assertOwner();trusted=true;return recovered;
  }
  /** @type {Methods['append']} */
  function append(operations,currentState,{generation=0,surface='shared-checks',mutationType='edit',deleteIds=[]}={}){
    assertTrusted();const verified=validateSharedChecksState(currentState);validate(verified);
    if(!Array.isArray(operations)||!operations.length)throw new Error('shared_checks_operations_required');
    const records=new Map(verified.checks.map(check=>[check.id,check]));
    const deleted=new Set(operations.filter(operation=>operation?.type==='delete').map(operation=>operation.id));
    const explicitDeletes=new Set((Array.isArray(deleteIds)?deleteIds:[]).map(id=>String(id||'').trim()).filter(Boolean));
    if(deleted.size!==explicitDeletes.size||[...deleted].some(id=>!explicitDeletes.has(id)))throw new Error('shared_checks_delete_intents_mismatch');
    const changes=operations.map(/** @returns {import('./storage-records.js').StorageChange} */ operation=>{
      if(operation.collection!=='checks'||!['put','delete'].includes(operation.type))throw new Error('shared_checks_operation_invalid');
      if(operation.type==='delete'){
        if(records.has(operation.id))throw new Error('shared_checks_delete_still_visible');
        return {type:'delete',collection:'checks',id:operation.id};
      }
      const record=records.get(operation.id);
      if(!record)throw new Error('shared_checks_operation_record_missing');
      return {...operation,record:structuredClone(record)};
    });
    return journal.append(changes,{generation,surface,mutationType,deleteIntents:{checks:[...explicitDeletes]}});
  }
  /** @type {Methods['captureCloudCursor']} */
  async function captureCloudCursor(revision,authoritativeState){
    assertCloudWriter();
    const canonical=canonicalState(authoritativeState);validate(canonical);
    const current=await journal.recover();
    if(!current||!equalSyncJson(current.state,canonical))throw new Error('shared_checks_cursor_state_mismatch');
    const existing=await journal.cloudState();
    if(existing.base||existing.flight||existing.pending)throw new Error('shared_checks_cursor_already_initialized');
    return journal.captureCloudCursor(revision);
  }
  /** @type {Methods['cloudState']} */
  async function cloudState(){assertTrusted();return journal.cloudState()}
  /** @type {Methods['materializeFlight']} */
  async function materializeFlight({operationId:flightId,throughSeq,snapshot,prepareAudit}={}){
    assertCloudWriter();const state=await journal.cloudState();
    if(state.control?.conflict)throw new Error('shared_checks_conflict_blocked');
    if(state.flight)return state.flight;
    if(!state.base)throw new Error('shared_checks_cursor_missing');
    return journal.materializeFlight({baseRevision:state.base.revision,...(flightId===undefined?{}:{operationId:flightId}),...(throughSeq===undefined?{}:{throughSeq}),...(prepareAudit===undefined?{}:{prepareAudit}),...(snapshot===undefined?{}:{snapshot:canonicalState(snapshot)})});
  }
  /** @type {Methods['acknowledge']} */
  async function acknowledge(flightId,revision,authoritativeState,options){
    const {currentState,expectedSeq,control=null}=options||{};
    assertCloudWriter();const authoritative=canonicalState(authoritativeState),current=canonicalState(currentState);validate(authoritative);validate(current);
    if(!Number.isSafeInteger(expectedSeq)||expectedSeq<0)throw new Error('shared_checks_ack_sequence_required');
    // Bank events are generated by the Shared Checks RPC. They must enter the
    // local checkpoint in the same atomic transaction as the cloud ACK.
    if(!equalSyncJson(current.bankEvents,authoritative.bankEvents))throw new Error('shared_checks_ack_bank_events_missing');
    return journal.acknowledge(flightId,revision,authoritative,{checkpointState:current,expectedSeq,control});
  }
  /** @type {Methods['rejectAndRebase']} */
  async function rejectAndRebase(flightId,revision,authoritativeState,options){
    const {currentState,expectedSeq,control=null}=options||{};
    assertCloudWriter();const authoritative=canonicalState(authoritativeState),current=canonicalState(currentState);validate(authoritative);validate(current);
    if(!equalSyncJson(current.bankEvents,authoritative.bankEvents))throw new Error('shared_checks_rebase_bank_events_missing');
    return journal.rejectAndRebase(flightId,revision,authoritative,{checkpointState:current,expectedSeq,control});
  }
  /** @type {Methods['adoptCloudHead']} */
  async function adoptCloudHead(revision,authoritativeState){
    assertCloudWriter();const authoritative=canonicalState(authoritativeState);validate(authoritative);
    const state=await journal.cloudState();
    if(!state.base||state.flight||state.pending||state.control?.conflict)throw new Error('shared_checks_cloud_pending');
    return journal.adoptCloudHead(revision,authoritative,authoritative);
  }
  /** @type {Methods['replaceAuthoritativeState']} */
  async function replaceAuthoritativeState(state,{boundaryId=null}={}){assertTrusted();const canonical=canonicalState(state);validate(canonical);return journal.replaceAuthoritativeState(canonical,{appMetadata:{storageRole:'shared-checks-primary',...boundaryId?{boundaryId}:{}}})}
  /** @type {Methods['replaceLocalWithPending']} */
  async function replaceLocalWithPending(state,options){
    const {boundaryId,expectedSeq,expectedBaseRevision}=options||{};
    assertCloudWriter();return journal.replaceLocalWithPending(canonicalState(state),{boundaryId,expectedSeq,expectedBaseRevision,deleteCollections:['checks']});
  }
  /** @type {Methods['replaceLocalAuthoritativeState']} */
  async function replaceLocalAuthoritativeState(state,options){
    const {boundaryId,expectedSeq}=options||{};
    assertTrusted();if(identity!=='local')throw new Error('shared_checks_local_owner_required');
    return journal.replaceLocalAuthoritativeState(canonicalState(state),{boundaryId,expectedSeq});
  }
  /** @type {Methods['resetCloudHead']} */
  async function resetCloudHead(revision,state,{boundaryId=null}={}){assertCloudWriter();const canonical=canonicalState(state);validate(canonical);return journal.resetCloudHead(revision,canonical,canonical,{appMetadata:{storageRole:'shared-checks-primary',...boundaryId?{boundaryId}:{}}})}
  async function settled(){assertTrusted();await journal.settled();assertTrusted();if(journal.error)throw journal.error}
  return {settled,recoverReadOnly,open,initializeCloudHead,append,captureCloudCursor,cloudState,materializeFlight,acknowledge,rejectAndRebase,adoptCloudHead,
    replaceAuthoritativeState,replaceLocalWithPending,replaceLocalAuthoritativeState,resetCloudHead,recover:()=>{assertTrusted();return journal.recover()},compact:()=>{assertTrusted();return journal.compact()},setCloudControl:(/** @type {import('./storage-journal-contracts.js').ControlInput} */ value)=>{assertCloudWriter();return journal.setCloudControl(value)},clearCloudControl:()=>{assertCloudWriter();return journal.clearCloudControl()},
    get epoch(){return journal.epoch},get ready(){return trusted&&journal.ready},get journalBlocked(){return !!journal.error},get owner(){return identity},get seq(){return journal.seq}};
}

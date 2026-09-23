import {createStorageJournal} from './storage-journal.js';
import {createStorageJournalDb} from './storage-journal-idb.js';
import {assertStorageJson,readStorageRecord} from './storage-journal-model.js';
import {equalSyncJson} from './cloud-sync.js';

const SCHEMA=Object.freeze({collections:['checks'],fields:['bankEvents']});

export function validateSharedChecksState(state){
  assertStorageJson(state);
  if(!state||!Array.isArray(state.checks)||!Array.isArray(state.bankEvents))throw new Error('shared_checks_state_invalid');
  const ids=new Set();
  for(const check of state.checks){
    if(!check||typeof check!=='object'||typeof check.id!=='string'||!check.id.trim()||ids.has(check.id))throw new Error('shared_checks_identity_invalid');
    ids.add(check.id);
  }
  const eventSeqs=new Set();
  for(const event of state.bankEvents){
    if(!event||!Number.isSafeInteger(event.seq)||event.seq<1||typeof event.checkId!=='string'||!event.checkId.trim()||eventSeqs.has(event.seq))throw new Error('shared_checks_bank_event_invalid');
    eventSeqs.add(event.seq);
  }
  return state;
}
function canonicalState(state){validateSharedChecksState(state);return {checks:structuredClone(state.checks),bankEvents:structuredClone(state.bankEvents)}}

// Shared Checks has its own cloud revision, so it must never share the main
// document's cursor or flight. The caller owns the business merge and RPC;
// this store owns local durability and the exact pending cloud payload.
export function createSharedChecksStorageV2({owner,primary,role='primary',validate=validateSharedChecksState,createJournal=createStorageJournal,db,emergency,operationId,now}={}){
  if(typeof owner!=='function'||typeof primary!=='function')throw new Error('shared_checks_storage_configuration');
  if(!['primary','shadow'].includes(role))throw new Error('shared_checks_storage_role_invalid');
  const identity=String(owner()||'').trim();
  if(!identity)throw new Error('shared_checks_owner_required');
  const scopedOwner=`${identity}:shared-checks`,database=db||createStorageJournalDb();
  const journal=createJournal({owner:scopedOwner,schema:SCHEMA,validate,
    primary:()=>primary()&&String(owner()||'').trim()===identity,db:database,emergency,operationId,now});
  let trusted=false;
  const assertOwner=()=>{if(!primary())throw new Error('storage_secondary_tab');if(String(owner()||'').trim()!==identity)throw new Error('shared_checks_owner_changed')};
  const assertTrusted=()=>{assertOwner();if(!trusted)throw new Error('shared_checks_storage_not_open')};
  const assertCloudWriter=()=>{assertTrusted();if(role!=='primary')throw new Error('shared_checks_shadow_cloud_write_forbidden')};

  async function open({migrationState=null,migrationIntent=null,sourceOwner=null}={}){
    assertOwner();const stored=await database.load(scopedOwner);
    if(stored.checkpoints&&readStorageRecord(stored.checkpoints).appMetadata?.storageRole!==`shared-checks-${role}`)throw new Error('shared_checks_storage_role_mismatch');
    const recovered=await journal.open();
    if(recovered){if(recovered.appMetadata?.storageRole!==`shared-checks-${role}`)throw new Error('shared_checks_storage_role_mismatch');trusted=true;return recovered}
    if(migrationState===null)return null;
    const source=String(sourceOwner||'').trim(),sameOwner=source===identity;
    if(!sameOwner||(role==='shadow'?migrationIntent!=='shadow-observation':!['legacy-upgrade','cloud-authoritative'].includes(migrationIntent)))throw new Error('shared_checks_owner_transfer_intent_required');
    validate(migrationState);
    await journal.install(canonicalState(migrationState),{expectedEpoch:null,appMetadata:{storageRole:`shared-checks-${role}`,migrationIntent,sourceOwner:source}});
    trusted=true;return journal.recover();
  }
  async function promoteVerifiedShadow(authoritativeState,{legacyPendingClean=false}={}){
    assertOwner();if(role!=='primary'||!legacyPendingClean)throw new Error('shared_checks_promotion_not_verified');
    const canonical=canonicalState(authoritativeState);validate(canonical);
    const stored=await database.load(scopedOwner);
    if(!stored.checkpoints||readStorageRecord(stored.checkpoints).appMetadata?.storageRole!=='shared-checks-shadow')throw new Error('shared_checks_shadow_checkpoint_missing');
    const recovered=await journal.open();
    if(!recovered||recovered.appMetadata?.storageRole!=='shared-checks-shadow'||!equalSyncJson(recovered.state,canonical))throw new Error('shared_checks_shadow_parity_mismatch');
    const cloud=await journal.cloudState();
    if(cloud.base||cloud.flight||cloud.control)throw new Error('shared_checks_shadow_cloud_state_invalid');
    await journal.replaceAuthoritativeState(canonical,{appMetadata:{storageRole:'shared-checks-primary',migrationIntent:'verified-shadow-promotion',sourceOwner:identity}});
    trusted=true;return journal.recover();
  }
  function append(operations,currentState,{generation=0,surface='shared-checks',mutationType='edit',deleteIds=[]}={}){
    assertTrusted();validate(currentState);
    if(!Array.isArray(operations)||!operations.length)throw new Error('shared_checks_operations_required');
    const records=new Map(currentState.checks.map(check=>[check.id,check]));
    const deleted=new Set(operations.filter(operation=>operation?.type==='delete').map(operation=>operation.id));
    const explicitDeletes=new Set((Array.isArray(deleteIds)?deleteIds:[]).map(id=>String(id||'').trim()).filter(Boolean));
    if(deleted.size!==explicitDeletes.size||[...deleted].some(id=>!explicitDeletes.has(id)))throw new Error('shared_checks_delete_intents_mismatch');
    const changes=operations.map(operation=>{
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
  async function captureCloudCursor(revision,authoritativeState,{legacyPendingClean=false}={}){
    assertCloudWriter();if(!legacyPendingClean)throw new Error('shared_checks_legacy_pending_unverified');
    const canonical=canonicalState(authoritativeState);validate(canonical);
    const current=await journal.recover();
    if(!current||!equalSyncJson(current.state,canonical))throw new Error('shared_checks_cursor_state_mismatch');
    const existing=await journal.cloudState();
    if(existing.base||existing.flight||existing.pending)throw new Error('shared_checks_cursor_already_initialized');
    return journal.captureCloudCursor(revision);
  }
  async function cloudState(){assertTrusted();return journal.cloudState()}
  async function materializeFlight({operationId:flightId,throughSeq,snapshot}={}){
    assertCloudWriter();const state=await journal.cloudState();
    if(state.control?.conflict)throw new Error('shared_checks_conflict_blocked');
    if(state.flight)return state.flight;
    if(!state.base)throw new Error('shared_checks_cursor_missing');
    return journal.materializeFlight({operationId:flightId,baseRevision:state.base.revision,throughSeq,snapshot:snapshot===undefined?undefined:canonicalState(snapshot)});
  }
  async function acknowledge(flightId,revision,authoritativeState,{currentState,expectedSeq,control=null}={}){
    assertCloudWriter();const authoritative=canonicalState(authoritativeState),current=canonicalState(currentState);validate(authoritative);validate(current);
    if(!Number.isSafeInteger(expectedSeq)||expectedSeq<0)throw new Error('shared_checks_ack_sequence_required');
    // Bank events are generated by the Shared Checks RPC. They must enter the
    // local checkpoint in the same atomic transaction as the cloud ACK.
    if(!equalSyncJson(current.bankEvents,authoritative.bankEvents))throw new Error('shared_checks_ack_bank_events_missing');
    return journal.acknowledge(flightId,revision,authoritative,{checkpointState:current,expectedSeq,control});
  }
  async function rejectAndRebase(flightId,revision,authoritativeState,{currentState,expectedSeq,control=null}={}){
    assertCloudWriter();const authoritative=canonicalState(authoritativeState),current=canonicalState(currentState);validate(authoritative);validate(current);
    if(!equalSyncJson(current.bankEvents,authoritative.bankEvents))throw new Error('shared_checks_rebase_bank_events_missing');
    return journal.rejectAndRebase(flightId,revision,authoritative,{checkpointState:current,expectedSeq,control});
  }
  async function adoptCloudHead(revision,authoritativeState){
    assertCloudWriter();const authoritative=canonicalState(authoritativeState);validate(authoritative);
    const state=await journal.cloudState();
    if(!state.base||state.flight||state.pending||state.control?.conflict)throw new Error('shared_checks_cloud_pending');
    return journal.adoptCloudHead(revision,authoritative,authoritative);
  }
  async function replaceAuthoritativeState(state){assertTrusted();const canonical=canonicalState(state);validate(canonical);return journal.replaceAuthoritativeState(canonical,{appMetadata:{storageRole:`shared-checks-${role}`}})}
  return {open,promoteVerifiedShadow,append,captureCloudCursor,cloudState,materializeFlight,acknowledge,rejectAndRebase,adoptCloudHead,
    replaceAuthoritativeState,recover:()=>{assertTrusted();return journal.recover()},compact:()=>{assertTrusted();return journal.compact()},setCloudControl:value=>{assertCloudWriter();return journal.setCloudControl(value)},clearCloudControl:()=>{assertCloudWriter();return journal.clearCloudControl()},
    get ready(){return trusted&&journal.ready},get owner(){return identity},get seq(){return journal.seq}};
}

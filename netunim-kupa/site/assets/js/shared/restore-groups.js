import {readServerRestorePending} from './restore-response-records.js';
import {createRestoreGroupKeys} from './restore-group-keys.js';
const RESTORE_SCHEMA_VERSION=1;
/** @typedef {import('./restore-group-contracts.js').RestoreMethods} RestoreMethods */
/** @typedef {import('./restore-group-contracts.js').RestoreGroup} RestoreGroup */
/** @typedef {import('./restore-group-contracts.js').RestoreStore} RestoreStore */

/** @template Value @param {Value} value @returns {Value} */
function clone(value){return value==null?value:structuredClone(value)}
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value){return !!value&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} value @param {string} key @returns {unknown} */
function field(value,key){return /** @type {Record<string,unknown>|null|undefined} */ (value)?.[key]}

/** @param {unknown} value @returns {string|undefined} */
export function canonicalJson(value){
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(/** @type {Record<string,unknown>} */ (value)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** @type {RestoreMethods['restorePayloadHash']} */
export async function restorePayloadHash(value,{cryptoImpl=globalThis.crypto}={}){
  if(!cryptoImpl?.subtle?.digest)throw new Error('restore_sha256_unavailable');
  const digest=await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** @param {unknown} target @param {{optional?:boolean}} [options] @returns {boolean} */
function validTarget(target,{optional=false}={}){
  if(target==null&&optional)return true;
  return !!(record(target)
    &&String(target.documentName||'').trim()
    &&Number.isSafeInteger(Number(target.baseRevision))&&Number(target.baseRevision)>=0
    &&target.state&&typeof target.state==='object'&&!Array.isArray(target.state)
    &&String(target.operationId||'').trim()
    &&/^[0-9a-f]{64}$/.test(String(target.payloadHash||'')));
}

/** @template Value @param {Value} group @returns {Value & RestoreGroup} */
export function assertRestoreGroup(group){
  if(!record(group)
    ||group.schemaVersion!==RESTORE_SCHEMA_VERSION
    ||!['kupa','orders'].some(site=>site===group.appSite)
    ||group.owner!==undefined&&(typeof group.owner!=='string'||!group.owner.trim())
    ||!/^[0-9a-f-]{20,}$/i.test(String(group.restoreGroupId||''))
    ||!validTarget(group.main)
    ||!validTarget(group.checks,{optional:true})
    ||!['staged','cloud_staged','applying','completed'].some(phase=>phase===group.phase)
    ||!Number.isSafeInteger(Number(group.mutationSeq))||Number(group.mutationSeq)<1){
    throw new Error('invalid_restore_group_record');
  }
  // Preserve known constructor fields while exposing only runtime-proven fields
  // when the input was unknown persisted data.
  return /** @type {Value & RestoreGroup} */ (group);
}

/** @type {RestoreMethods['createRestoreGroup']} */
export async function createRestoreGroup({appSite,owner=null,main,checks=null,beforeState=null,localTargetState=null,restoreGroupId=null,now=Date.now,cryptoImpl=globalThis.crypto}={}){
  const id=String(restoreGroupId||cryptoImpl?.randomUUID?.()||'').trim();
  if(!id)throw new Error('restore_group_id_unavailable');
  /** @param {import('./restore-group-contracts.js').InputTarget|null|undefined} target @param {'main'|'checks'} kind */
  const makeTarget=async(target,kind)=>{
    if(!target)return null;
    const state=clone(target.state),deleteIntent=kind==='checks'
      ?[...new Set((target.deleteIds||[]).map(value=>String(value||'').trim()).filter(Boolean))].sort()
      :clone(target.deleteIntents||{});
    return {
      documentName:String(target.documentName||'main'),baseRevision:Number(target.baseRevision||0),state,
      ...(kind==='checks'?{deleteIds:deleteIntent}:{deleteIntents:deleteIntent}),
      operationId:String(target.operationId||`${appSite}-restore:${id}:${kind}`),
      payloadHash:await restorePayloadHash(kind==='checks'?{state,deleteIds:deleteIntent}:{state,deleteIntents:deleteIntent},{cryptoImpl}),
    };
  };
  const createdAt=new Date(Number(typeof now==='function'?now():now)).toISOString();
  return assertRestoreGroup({schemaVersion:RESTORE_SCHEMA_VERSION,checkAmountPrecision:2,restoreGroupId:id,appSite,...(owner===null?{}:{owner}),phase:'staged',mutationSeq:1,createdAt,updatedAt:createdAt,main:await makeTarget(main,'main'),checks:await makeTarget(checks,'checks'),beforeState:clone(beforeState),localTargetState:clone(localTargetState)});
}

/** @type {RestoreMethods['samePayload']} */
function samePayload(a,b){return field(a,'restoreGroupId')===field(b,'restoreGroupId')&&field(a,'checkAmountPrecision')===field(b,'checkAmountPrecision')&&field(field(a,'main'),'payloadHash')===field(field(b,'main'),'payloadHash')&&field(field(a,'checks'),'payloadHash')===field(field(b,'checks'),'payloadHash')}
/** @type {RestoreMethods['chooseNewer']} */
function chooseNewer(a,b){if(!a)return b||null;if(!b)return a;const delta=Number(field(a,'mutationSeq')||0)-Number(field(b,'mutationSeq')||0);return delta?delta>0?a:b:(/** @type {string} */ (canonicalJson(a))>=/** @type {string} */ (canonicalJson(b))?a:b)}

/** @param {Partial<import('./restore-group-contracts.js').StoreOptions>} [options] @returns {RestoreStore} */
export function createRestoreGroupStore({localKey:configuredKey,put:configuredPut,get:configuredGet,remove:configuredRemove,storage=globalThis.localStorage,now=Date.now}={}){
  if(!configuredKey||typeof configuredPut!=='function'||typeof configuredGet!=='function'||typeof configuredRemove!=='function')throw new Error('restore_store_dependencies_missing');
  const localKey=configuredKey,put=configuredPut,get=configuredGet,remove=configuredRemove;
  const keys=createRestoreGroupKeys(localKey),currentKey=keys.current,archiveKey=keys.archive;
  /** @type {RestoreMethods['readLocal']} */
  function readLocal(){try{return JSON.parse(storage.getItem(localKey)||'null')}catch(error){throw new Error('restore_local_read_failed',{cause:error})}}
  /** @type {RestoreMethods['writeLocal']} */
  function writeLocal(group){try{const text=JSON.stringify(group);storage.setItem(localKey,text);if(storage.getItem(localKey)!==text)throw new Error('restore local verification failed')}catch(error){throw new Error('restore_local_write_failed',{cause:error})}}
  /** @type {RestoreMethods['writeEverywhere']} */
  async function writeEverywhere(group){
    assertRestoreGroup(group);writeLocal(group);await put(currentKey,clone(group));
    // The key boundary has always required a string. Retain its validation and
    // error after the current-key write, before touching the archive.
    if(typeof group.restoreGroupId!=='string'||!group.restoreGroupId.trim())throw new Error('storage_restore_group_key_required');
    const archived=await get(archiveKey(group.restoreGroupId));
    if(archived&&!samePayload(archived,group))throw new Error('restore_group_id_reuse');
    await put(archiveKey(group.restoreGroupId),clone(group));
    const verified=await get(currentKey);if(!verified||!samePayload(verified,group)||Number(field(verified,'mutationSeq'))!==Number(group.mutationSeq))throw new Error('restore_idb_verification_failed');
    return /** @type {import('./restore-group-contracts.js').StoredRestoreGroup} */ (group);
  }
  /** @type {RestoreStore['stage']} */
  async function stage(group){return writeEverywhere(assertRestoreGroup(clone(group)))}
  /** @type {RestoreStore['loadPending']} */
  async function loadPending(){
    let local=null,durable=null;local=readLocal();durable=await get(currentKey);const chosen=chooseNewer(local,durable);
    if(field(local,'restoreGroupId')&&field(durable,'restoreGroupId')&&field(local,'restoreGroupId')!==field(durable,'restoreGroupId'))throw new Error('restore_store_disagreement');
    if(!chosen)return null;const group=assertRestoreGroup(chosen);
    if(group.phase==='completed'){
      await writeEverywhere(group);
      try{storage.removeItem(localKey)}catch(error){throw new Error('restore_local_clear_failed',{cause:error})}
      await remove(currentKey);return null;
    }
    return writeEverywhere(group);
  }
  /** @type {RestoreStore['advance']} */
  async function advance(group,phase){
    assertRestoreGroup(group);if(!['staged','cloud_staged','applying','completed'].includes(phase))throw new Error('invalid_restore_phase');
    const updated={...clone(group),phase,mutationSeq:Number(group.mutationSeq)+1,updatedAt:new Date(Number(typeof now==='function'?now():now)).toISOString()};
    return writeEverywhere(updated);
  }
  /** @type {RestoreStore['complete']} */
  async function complete(group){
    const completed=group.phase==='completed'?group:await advance(group,'completed');
    try{storage.removeItem(localKey)}catch(error){throw new Error('restore_local_clear_failed',{cause:error})}
    await remove(currentKey);return completed;
  }
  const serverKey=keys.server;
  /** @type {RestoreStore['loadServerPending']} */
  async function loadServerPending(owner){
    const record=await get(serverKey(owner));
    return record==null?null:readServerRestorePending(record,owner);
  }
  /** @type {RestoreStore['stageServerPending']} */
  async function stageServerPending(record){
    const next=readServerRestorePending(record,record.owner),prior=await loadServerPending(next.owner);
    if(prior&&prior.restore_group_id!==next.restore_group_id)throw new Error('restore_server_pending_changed');
    await put(serverKey(next.owner),clone(next));
    const saved=await loadServerPending(next.owner);
    if(!saved||canonicalJson(saved)!==canonicalJson(next))throw new Error('restore_server_pending_write_failed');
    return saved;
  }
  /** @type {RestoreStore['completeServerPending']} */
  async function completeServerPending(owner,id){
    const prior=await loadServerPending(owner);
    if(!prior||prior.restore_group_id!==id)throw new Error('restore_server_pending_changed');
    await remove(serverKey(owner));
  }
  return {stage,loadPending,advance,complete,archiveKey,loadServerPending,stageServerPending,completeServerPending};
}

/** @param {import('./restore-group-contracts.js').StoredRestoreGroup} group */
export function restoreGroupRpcPayload(group){
  assertRestoreGroup(group);return {
    p_restore_group_id:group.restoreGroupId,p_app_site:group.appSite,
    p_main_document_name:group.main.documentName,p_main_base_revision:group.main.baseRevision,p_main_state:group.main.state,p_main_delete_intents:group.main.deleteIntents||{},
    p_checks_document_name:group.checks?.documentName||'main',p_checks_base_revision:group.checks?.baseRevision??null,p_checks_state:group.checks?.state??null,p_checks_delete_ids:group.checks?.deleteIds||[],
    p_main_operation_id:group.main.operationId,p_checks_operation_id:group.checks?.operationId??null,
    p_audit:{mutationType:'restore',restoreGroupId:group.restoreGroupId,app:group.appSite,surface:'backup.restore',...(group.checkAmountPrecision===2?{checkAmountPrecision:2}:{})},
  };
}

/** @template Result @param {unknown} group @param {Partial<import('./restore-group-contracts.js').RestoreExecutor<Result>>} [options] */
export async function executeRestoreGroup(group,{store,stageRemote,applyRemote,onApplied}={}){
  if(!store||typeof stageRemote!=='function'||typeof applyRemote!=='function'||typeof onApplied!=='function')throw new Error('restore_executor_dependencies_missing');
  let current=await store.stage(group);
  await stageRemote(current);current=await store.advance(current,'cloud_staged');
  current=await store.advance(current,'applying');
  const result=await applyRemote(current.restoreGroupId);
  await onApplied(current,result);current=await store.complete(current);
  return {group:current,result};
}

/** @template Result @param {Partial<import('./restore-group-contracts.js').RestoreExecutor<Result>>} [options] */
export async function resumeRestoreGroup({store,stageRemote,applyRemote,onApplied}={}){
  if(!store)throw new Error('restore_executor_dependencies_missing');
  const group=await store.loadPending();if(!group)return null;
  return executeRestoreGroup(group,{store,...(stageRemote?{stageRemote}:{}),...(applyRemote?{applyRemote}:{}),...(onApplied?{onApplied}:{})});
}

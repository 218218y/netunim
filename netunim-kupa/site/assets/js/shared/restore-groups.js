const RESTORE_SCHEMA_VERSION=1;

function clone(value){return value==null?value:structuredClone(value)}

export function canonicalJson(value){
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export async function restorePayloadHash(value,{cryptoImpl=globalThis.crypto}={}){
  if(!cryptoImpl?.subtle?.digest)throw new Error('restore_sha256_unavailable');
  const digest=await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

function validTarget(target,{optional=false}={}){
  if(target==null&&optional)return true;
  return !!(target&&typeof target==='object'&&!Array.isArray(target)
    &&String(target.documentName||'').trim()
    &&Number.isSafeInteger(Number(target.baseRevision))&&Number(target.baseRevision)>=0
    &&target.state&&typeof target.state==='object'&&!Array.isArray(target.state)
    &&String(target.operationId||'').trim()
    &&/^[0-9a-f]{64}$/.test(String(target.payloadHash||'')));
}

export function assertRestoreGroup(group){
  if(!group||typeof group!=='object'||Array.isArray(group)
    ||group.schemaVersion!==RESTORE_SCHEMA_VERSION
    ||!['kupa','orders'].includes(group.appSite)
    ||!/^[0-9a-f-]{20,}$/i.test(String(group.restoreGroupId||''))
    ||!validTarget(group.main)
    ||!validTarget(group.checks,{optional:true})
    ||!['staged','cloud_staged','applying','completed'].includes(group.phase)
    ||!Number.isSafeInteger(Number(group.mutationSeq))||Number(group.mutationSeq)<1){
    throw new Error('invalid_restore_group_record');
  }
  return group;
}

export async function createRestoreGroup({appSite,main,checks=null,beforeState=null,localTargetState=null,restoreGroupId=null,now=Date.now,cryptoImpl=globalThis.crypto}={}){
  const id=String(restoreGroupId||cryptoImpl?.randomUUID?.()||'').trim();
  if(!id)throw new Error('restore_group_id_unavailable');
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
  return assertRestoreGroup({schemaVersion:RESTORE_SCHEMA_VERSION,restoreGroupId:id,appSite,phase:'staged',mutationSeq:1,createdAt,updatedAt:createdAt,main:await makeTarget(main,'main'),checks:await makeTarget(checks,'checks'),beforeState:clone(beforeState),localTargetState:clone(localTargetState)});
}

function samePayload(a,b){return a?.restoreGroupId===b?.restoreGroupId&&a?.main?.payloadHash===b?.main?.payloadHash&&a?.checks?.payloadHash===b?.checks?.payloadHash}
function chooseNewer(a,b){if(!a)return b||null;if(!b)return a;const delta=Number(a.mutationSeq||0)-Number(b.mutationSeq||0);return delta?delta>0?a:b:(canonicalJson(a)>=canonicalJson(b)?a:b)}

export function createRestoreGroupStore({localKey,put,get,remove,storage=globalThis.localStorage,now=Date.now}={}){
  if(!localKey||typeof put!=='function'||typeof get!=='function'||typeof remove!=='function')throw new Error('restore_store_dependencies_missing');
  const currentKey=`${localKey}:current`,archiveKey=id=>`${localKey}:archive:${id}`;
  function readLocal(){try{return JSON.parse(storage.getItem(localKey)||'null')}catch(error){throw new Error('restore_local_read_failed',{cause:error})}}
  function writeLocal(group){try{const text=JSON.stringify(group);storage.setItem(localKey,text);if(storage.getItem(localKey)!==text)throw new Error('restore local verification failed')}catch(error){throw new Error('restore_local_write_failed',{cause:error})}}
  async function writeEverywhere(group){
    assertRestoreGroup(group);writeLocal(group);await put(currentKey,clone(group));
    const archived=await get(archiveKey(group.restoreGroupId));
    if(archived&&!samePayload(archived,group))throw new Error('restore_group_id_reuse');
    await put(archiveKey(group.restoreGroupId),clone(group));
    const verified=await get(currentKey);if(!verified||!samePayload(verified,group)||Number(verified.mutationSeq)!==Number(group.mutationSeq))throw new Error('restore_idb_verification_failed');
    return group;
  }
  async function stage(group){return writeEverywhere(assertRestoreGroup(clone(group)))}
  async function loadPending(){
    let local=null,durable=null;local=readLocal();durable=await get(currentKey);const chosen=chooseNewer(local,durable);
    if(local?.restoreGroupId&&durable?.restoreGroupId&&local.restoreGroupId!==durable.restoreGroupId)throw new Error('restore_store_disagreement');
    if(!chosen)return null;assertRestoreGroup(chosen);
    if(chosen.phase==='completed'){
      await writeEverywhere(chosen);
      try{storage.removeItem(localKey)}catch(error){throw new Error('restore_local_clear_failed',{cause:error})}
      await remove(currentKey);return null;
    }
    await writeEverywhere(chosen);return chosen;
  }
  async function advance(group,phase){
    assertRestoreGroup(group);if(!['staged','cloud_staged','applying','completed'].includes(phase))throw new Error('invalid_restore_phase');
    const updated={...clone(group),phase,mutationSeq:Number(group.mutationSeq)+1,updatedAt:new Date(Number(typeof now==='function'?now():now)).toISOString()};
    return writeEverywhere(updated);
  }
  async function complete(group){
    const completed=group.phase==='completed'?group:await advance(group,'completed');
    try{storage.removeItem(localKey)}catch(error){throw new Error('restore_local_clear_failed',{cause:error})}
    await remove(currentKey);return completed;
  }
  return {stage,loadPending,advance,complete,archiveKey};
}

export function restoreGroupRpcPayload(group){
  assertRestoreGroup(group);return {
    p_restore_group_id:group.restoreGroupId,p_app_site:group.appSite,
    p_main_document_name:group.main.documentName,p_main_base_revision:group.main.baseRevision,p_main_state:group.main.state,p_main_delete_intents:group.main.deleteIntents||{},
    p_checks_document_name:group.checks?.documentName||'main',p_checks_base_revision:group.checks?.baseRevision??null,p_checks_state:group.checks?.state??null,p_checks_delete_ids:group.checks?.deleteIds||[],
    p_main_operation_id:group.main.operationId,p_checks_operation_id:group.checks?.operationId??null,
    p_audit:{mutationType:'restore',restoreGroupId:group.restoreGroupId,app:group.appSite,surface:'backup.restore'},
  };
}

export async function executeRestoreGroup(group,{store,stageRemote,applyRemote,onApplied}={}){
  if(!store||typeof stageRemote!=='function'||typeof applyRemote!=='function'||typeof onApplied!=='function')throw new Error('restore_executor_dependencies_missing');
  let current=await store.stage(group);
  await stageRemote(current);current=await store.advance(current,'cloud_staged');
  current=await store.advance(current,'applying');
  const result=await applyRemote(current.restoreGroupId);
  await onApplied(current,result);current=await store.complete(current);
  return {group:current,result};
}

export async function resumeRestoreGroup({store,stageRemote,applyRemote,onApplied}={}){
  const group=await store.loadPending();if(!group)return null;
  return executeRestoreGroup(group,{store,stageRemote,applyRemote,onApplied});
}

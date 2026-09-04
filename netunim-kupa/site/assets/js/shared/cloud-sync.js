export const OUTBOX_SCHEMA_VERSION=4;
export const CLOUD_WRITE_POLICY=Object.freeze({busyAttempts:3,conflictAttempts:3});

function copy(value){return value==null?value:structuredClone(value)}
function finiteRevision(value){const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:0}
function finiteGeneration(value){const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:0}
function iso(value,now){const parsed=Date.parse(String(value||''));return Number.isFinite(parsed)?new Date(parsed).toISOString():new Date(now()).toISOString()}
function nowMilliseconds(now=Date.now){const value=Number(typeof now==='function'?now():now);return Number.isFinite(value)?value:Date.now()}
function futureIso(value,now=Date.now){const parsed=Date.parse(String(value||'')),current=nowMilliseconds(now);return Number.isFinite(parsed)&&parsed>current?new Date(parsed).toISOString():null}

export function createOperationId(domain='sync',options={}){
  const settings=typeof options==='function'?{now:options,random:arguments[2]}:(options||{}),now=settings.now||Date.now,random=settings.random||Math.random;
  const randomUUID=Object.hasOwn(settings,'randomUUID')?settings.randomUUID:globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if(typeof randomUUID==='function')return `${String(domain||'sync')}:${randomUUID()}`;
  return `${String(domain||'sync')}:${now().toString(36)}:${random().toString(36).slice(2,10)}`;
}

export function createOutboxRecord({domain,documentName,operationId,generation,mutationSeq,baseRevision,baseState,snapshot,createdAt,updatedAt,conflict=null,retry=null,mutationType='autosave',surface='unknown',restoreGroupId=null},options={}){
  const now=options.now||Date.now,created=iso(createdAt,now),updated=iso(updatedAt||created,now);
  const normalizedGeneration=finiteGeneration(generation),normalizedMutationSeq=Math.max(normalizedGeneration,finiteGeneration(mutationSeq));
  return {
    schemaVersion:OUTBOX_SCHEMA_VERSION,
    domain:String(domain||'unknown'),
    documentName:String(documentName||'main'),
    operationId:String(operationId||createOperationId(domain,{now,random:options.random||Math.random,...(Object.hasOwn(options,'randomUUID')?{randomUUID:options.randomUUID}:{})})),
    generation:normalizedGeneration,
    mutationSeq:normalizedMutationSeq,
    baseRevision:finiteRevision(baseRevision),
    baseState:copy(baseState??{}),
    snapshot:copy(snapshot??{}),
    createdAt:created,
    updatedAt:updated,
    conflict:conflict?copy(conflict):null,
    mutationType:String(mutationType||'autosave').slice(0,80),
    surface:String(surface||'unknown').slice(0,120),
    restoreGroupId:restoreGroupId==null?null:String(restoreGroupId),
    retry:{
      attempts:finiteGeneration(retry?.attempts),
      lastErrorCode:retry?.lastErrorCode==null?null:String(retry.lastErrorCode),
      lastAttemptAt:retry?.lastAttemptAt?iso(retry.lastAttemptAt,now):null,
      nextAttemptAt:retry?.nextAttemptAt?iso(retry.nextAttemptAt,now):null,
    },
  };
}

export function getOutboxRetryDelay(record,now=Date.now){
  const nextAttempt=Date.parse(String(record?.retry?.nextAttemptAt||''));
  if(!Number.isFinite(nextAttempt))return 0;
  return Math.max(0,nextAttempt-nowMilliseconds(now));
}

export function outboxRetryForGeneration(existing,{sameGeneration=false,retry=undefined,now=Date.now}={}){
  const selected=retry===undefined?(sameGeneration?existing?.retry:null):retry,current=nowMilliseconds(now);
  const previousNotBefore=futureIso(existing?.retry?.nextAttemptAt,current),selectedNotBefore=futureIso(selected?.nextAttemptAt,current);
  const nextAttemptAt=!previousNotBefore?selectedNotBefore:!selectedNotBefore?previousNotBefore:(Date.parse(previousNotBefore)>=Date.parse(selectedNotBefore)?previousNotBefore:selectedNotBefore);
  return {
    attempts:finiteGeneration(selected?.attempts),
    lastErrorCode:selected?.lastErrorCode==null?null:String(selected.lastErrorCode),
    lastAttemptAt:selected?.lastAttemptAt?iso(selected.lastAttemptAt,()=>current):null,
    nextAttemptAt,
  };
}

export function createOutboxRetryScheduler({now=Date.now,setTimer=(callback,delay)=>setTimeout(callback,delay),clearTimer=timer=>clearTimeout(timer),onError=error=>console.error('outbox retry callback',error)}={}){
  const MAX_TIMER_DELAY=2_147_483_647;let timer=null,key='',dueAt=0;
  function cancel(){if(timer!==null)clearTimer(timer);timer=null;key='';dueAt=0}
  function schedule(record,resume){
    const delay=getOutboxRetryDelay(record,now);if(delay<=0){if(timer!==null&&dueAt<=nowMilliseconds(now))cancel();return 0}
    const nextKey=[record?.domain,record?.documentName,finiteGeneration(record?.generation),record?.operationId,record?.retry?.nextAttemptAt].map(value=>String(value??'')).join('|');
    if(timer!==null&&key===nextKey)return delay;
    cancel();key=nextKey;dueAt=nowMilliseconds(now)+delay;
    const arm=()=>{const remaining=getOutboxRetryDelay(record,now);if(remaining>0){timer=setTimer(arm,Math.min(remaining,MAX_TIMER_DELAY));return}timer=null;key='';dueAt=0;try{const result=resume();if(result&&typeof result.catch==='function')result.catch(onError)}catch(error){onError(error)}};
    timer=setTimer(arm,Math.min(delay,MAX_TIMER_DELAY));return delay;
  }
  function stats(){return {scheduled:timer!==null,key,dueAt}}
  return {schedule,cancel,stats};
}

export function migrateOutboxRecord(value,{domain,documentName,baseRevision=0,baseState={},snapshot={},generation=1,now=Date.now}={}){
  if(!value||typeof value!=='object')return null;
  const marker=value.pending===true&&!value.snapshot;
  const sourceSnapshot=marker?snapshot:(value.snapshot??snapshot);
  const sourceBase=value.baseState??baseState;
  const sourceConflict=value.conflict===true?{kind:'unresolved'}:value.conflict;
  return createOutboxRecord({
    domain:value.domain||domain,
    documentName:value.documentName||documentName,
    operationId:value.operationId||value.id,
    generation:Math.max(finiteGeneration(value.generation),finiteGeneration(generation)),
    mutationSeq:Math.max(finiteGeneration(value.mutationSeq),finiteGeneration(value.commitSeq),finiteGeneration(value.generation),finiteGeneration(generation)),
    baseRevision:value.baseRevision??baseRevision,
    baseState:sourceBase,
    snapshot:sourceSnapshot,
    createdAt:value.createdAt||value.savedAt||value.updatedAt,
    updatedAt:value.updatedAt||value.savedAt,
    conflict:sourceConflict,
    retry:value.retry,
    mutationType:value.mutationType,
    surface:value.surface,
    restoreGroupId:value.restoreGroupId,
  },{now});
}

export function updateOutboxSnapshot(existing,{snapshot,generation,mutationSeq,updatedAt,conflict,retry}={}){
  if(!existing)throw new Error('outbox_record_required');
  return createOutboxRecord({...existing,
    snapshot:snapshot??existing.snapshot,
    generation:Math.max(finiteGeneration(existing.generation),finiteGeneration(generation)),
    mutationSeq:Math.max(finiteGeneration(existing.mutationSeq),finiteGeneration(mutationSeq),finiteGeneration(generation)),
    updatedAt:updatedAt||new Date().toISOString(),
    conflict:conflict===undefined?existing.conflict:conflict,
    retry:retry||existing.retry,
  });
}

export function acknowledgedGenerationMatches(record,acknowledgedGeneration){
  const acknowledged=Number(acknowledgedGeneration);
  return !!record&&Number.isSafeInteger(acknowledged)&&acknowledged>=0&&finiteGeneration(record.generation)===acknowledged;
}

export function compareOutboxFreshness(a,b){
  const generationDelta=finiteGeneration(a?.generation)-finiteGeneration(b?.generation);
  if(generationDelta)return generationDelta;
  const sequenceDelta=finiteGeneration(a?.mutationSeq??a?.commitSeq)-finiteGeneration(b?.mutationSeq??b?.commitSeq);
  if(sequenceDelta)return sequenceDelta;
  const operationDelta=String(a?.operationId||a?.id||'').localeCompare(String(b?.operationId||b?.id||''));
  if(operationDelta)return operationDelta;
  return JSON.stringify(a??null).localeCompare(JSON.stringify(b??null));
}

const CLIENT_INSTANCE_KEY='netunim.sync.client-instance.v1';
let ephemeralClientInstanceId='';
export function clientInstanceId(){
  if(ephemeralClientInstanceId)return ephemeralClientInstanceId;
  try{const existing=localStorage.getItem(CLIENT_INSTANCE_KEY);if(existing)return ephemeralClientInstanceId=existing;const id=globalThis.crypto?.randomUUID?.()||createOperationId('client');localStorage.setItem(CLIENT_INSTANCE_KEY,id);return ephemeralClientInstanceId=id}catch{return ephemeralClientInstanceId=globalThis.crypto?.randomUUID?.()||createOperationId('client-ephemeral')}
}

export function operationAuditMetadata({site,build='sync-v5',mutationType='autosave',surface='unknown',baseRevision=0,beforeState={},afterState={},collections=[],deleteCount=0,restoreGroupId=null}={}){
  const counts=source=>Object.fromEntries(collections.map(path=>{const value=String(path).split('.').reduce((x,key)=>x?.[key],source);return [path,Array.isArray(value)?value.length:0]}));
  return {clientInstanceId:clientInstanceId(),app:String(site||'unknown'),build:String(build),mutationType:String(mutationType),surface:String(surface),baseRevision:finiteRevision(baseRevision),beforeCount:counts(beforeState),afterCount:counts(afterState),deleteCount:finiteGeneration(deleteCount),restoreGroupId:restoreGroupId==null?null:String(restoreGroupId),timestamp:new Date().toISOString()};
}

function errorMessage(input){return String(input?.j?.message||input?.message||input?.body||input?.txt||input?.original?.message||'')}

function retryAfterMilliseconds(response,input){
  const explicit=Number(input?.retryAfterMs);
  if(Number.isFinite(explicit)&&explicit>0)return explicit;
  const raw=String(response?.headers?.get?.('retry-after')||'').trim();
  if(!raw)return null;
  const seconds=Number(raw);
  if(Number.isFinite(seconds)&&seconds>=0)return Math.round(seconds*1000);
  const at=Date.parse(raw);
  return Number.isFinite(at)?Math.max(0,at-Date.now()):null;
}

export function normalizeCloudError(input){
  const response=input?.r||input?.response||input;
  const status=Number(response?.status||input?.status||0)||null;
  const code=String(input?.j?.code||input?.code||input?.errorCode||'');
  const message=errorMessage(input);
  const lower=message.toLowerCase();
  let kind='fatal';
  if(code==='PT429'||lower.includes('save_busy'))kind='busy';
  else if(code==='PT409'||lower.includes('revision_conflict'))kind='revision_conflict';
  else if(status===429||code==='SUPABASE_DATA_API_RATE_LIMIT')kind='rate_limited';
  else if(status===409)kind='conflict';
  else if([502,503,504].includes(status)||['PGRST002','PGRST003','SUPABASE_DATA_API_BACKOFF'].includes(code))kind='service_unavailable';
  else if(status===401||status===403||code==='42501'||code==='cloud_auth_required')kind='auth';
  else if(code==='SUPABASE_NETWORK_TIMEOUT'||String(input?.name||'')==='AbortError'||lower.includes('timeout')||lower.includes('timed out'))kind='timeout';
  else if(code==='SUPABASE_NETWORK_UNAVAILABLE'||String(input?.name||'')==='TypeError'||lower.includes('failed to fetch')||lower.includes('networkerror')||lower.includes('load failed'))kind='network';
  const retryAfterMs=retryAfterMilliseconds(response,input);
  return {kind,code:code||null,status,retryAfterMs:retryAfterMs||null,original:input};
}

export function cloudWriteError(input,fallbackMessage='cloud_write_failed'){
  const normalized=normalizeCloudError(input),error=new Error(errorMessage(input)||fallbackMessage);
  error.name='CloudWriteError';error.kind=normalized.kind;error.code=normalized.code;error.status=normalized.status;error.retryAfterMs=normalized.retryAfterMs;error.response=input?.r||input?.response||null;error.cause=input;
  return error;
}

export function contentionDelay(attempt=0,{baseMs=300,maxMs=2400,jitterMs=200,random=Math.random}={}){
  return Math.min(maxMs,baseMs*Math.pow(2,Math.max(0,Number(attempt)||0)))+Math.floor(random()*Math.max(0,jitterMs));
}

export async function runBusyCloudWriteWithPolicy(write,{attempts=CLOUD_WRITE_POLICY.busyAttempts,delay=contentionDelay,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  let result=null;
  for(let attempt=0;attempt<Math.max(1,Number(attempts)||1);attempt++){
    result=await write(attempt);
    if(normalizeCloudError(result).kind!=='busy')return result;
    if(attempt+1<attempts)await sleep(delay(attempt));
  }
  return result;
}

export function createDataApiScheduler({maxHighBurst=4,canRun=()=>true}={}){
  const high=[],low=[],coalesced=new Map();let running=false,highBurst=0;
  function choose(){if(high.length&&(!low.length||highBurst<maxHighBurst)){highBurst++;return high.shift()}if(low.length){highBurst=0;return low.shift()}if(high.length){highBurst=1;return high.shift()}return null}
  async function drain(){if(running)return;running=true;try{for(;;){const item=choose();if(!item)break;try{if(!canRun(item))throw item.blockedError();item.resolve(await item.task())}catch(error){item.reject(error)}}}finally{running=false;if(high.length||low.length)queueMicrotask(drain)}}
  function schedule(task,{priority='low',key='',blockedError=()=>new Error('scheduler_blocked')}={}){
    const normalizedPriority=priority==='high'?'high':'low',coalesceKey=normalizedPriority==='low'&&key?String(key):'';
    if(coalesceKey&&coalesced.has(coalesceKey))return coalesced.get(coalesceKey);
    const promise=new Promise((resolve,reject)=>{(normalizedPriority==='high'?high:low).push({task,priority:normalizedPriority,key:coalesceKey,blockedError,resolve,reject});queueMicrotask(drain)});
    if(coalesceKey){coalesced.set(coalesceKey,promise);promise.finally(()=>{if(coalesced.get(coalesceKey)===promise)coalesced.delete(coalesceKey)}).catch(()=>{})}
    return promise;
  }
  function stats(){return {running,highQueued:high.length,lowQueued:low.length,coalesced:coalesced.size}}
  return {schedule,stats};
}

export const OUTBOX_SCHEMA_VERSION=3;
export const CLOUD_WRITE_POLICY=Object.freeze({busyAttempts:3,conflictAttempts:3});

function copy(value){return value==null?value:structuredClone(value)}
function finiteRevision(value){const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:0}
function finiteGeneration(value){const n=Number(value);return Number.isSafeInteger(n)&&n>=0?n:0}
function iso(value,now){const parsed=Date.parse(String(value||''));return Number.isFinite(parsed)?new Date(parsed).toISOString():new Date(now()).toISOString()}

export function createOperationId(domain='sync',now=Date.now,random=Math.random){
  return `${String(domain||'sync')}:${now().toString(36)}:${random().toString(36).slice(2,10)}`;
}

export function createOutboxRecord({domain,documentName,operationId,generation,baseRevision,baseState,snapshot,createdAt,updatedAt,conflict=null,retry=null},options={}){
  const now=options.now||Date.now,created=iso(createdAt,now),updated=iso(updatedAt||created,now);
  return {
    schemaVersion:OUTBOX_SCHEMA_VERSION,
    domain:String(domain||'unknown'),
    documentName:String(documentName||'main'),
    operationId:String(operationId||createOperationId(domain,now,options.random||Math.random)),
    generation:finiteGeneration(generation),
    baseRevision:finiteRevision(baseRevision),
    baseState:copy(baseState??{}),
    snapshot:copy(snapshot??{}),
    createdAt:created,
    updatedAt:updated,
    conflict:conflict?copy(conflict):null,
    retry:{
      attempts:finiteGeneration(retry?.attempts),
      lastErrorCode:retry?.lastErrorCode==null?null:String(retry.lastErrorCode),
      lastAttemptAt:retry?.lastAttemptAt?iso(retry.lastAttemptAt,now):null,
      nextAttemptAt:retry?.nextAttemptAt?iso(retry.nextAttemptAt,now):null,
    },
  };
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
    baseRevision:value.baseRevision??baseRevision,
    baseState:sourceBase,
    snapshot:sourceSnapshot,
    createdAt:value.createdAt||value.savedAt||value.updatedAt,
    updatedAt:value.updatedAt||value.savedAt,
    conflict:sourceConflict,
    retry:value.retry,
  },{now});
}

export function updateOutboxSnapshot(existing,{snapshot,generation,updatedAt,conflict,retry}={}){
  if(!existing)throw new Error('outbox_record_required');
  return createOutboxRecord({...existing,
    snapshot:snapshot??existing.snapshot,
    generation:Math.max(finiteGeneration(existing.generation),finiteGeneration(generation)),
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
  return Date.parse(a?.updatedAt||a?.savedAt||0)-Date.parse(b?.updatedAt||b?.savedAt||0);
}

function errorMessage(input){return String(input?.j?.message||input?.message||input?.body||input?.txt||input?.original?.message||'')}

export function normalizeCloudError(input){
  const response=input?.r||input?.response||input;
  const status=Number(response?.status||input?.status||0)||null;
  const code=String(input?.j?.code||input?.code||input?.errorCode||'');
  const message=errorMessage(input);
  const lower=message.toLowerCase();
  let kind='fatal';
  if(status===429||code==='PT429'||lower.includes('save_busy'))kind='busy';
  else if(status===409||code==='PT409'||lower.includes('revision_conflict'))kind='revision_conflict';
  else if([502,503,504].includes(status)||['PGRST002','PGRST003','SUPABASE_DATA_API_BACKOFF'].includes(code))kind='service_unavailable';
  else if(status===401||status===403||code==='42501'||code==='cloud_auth_required')kind='auth';
  else if(code==='SUPABASE_NETWORK_TIMEOUT'||String(input?.name||'')==='AbortError'||lower.includes('timeout')||lower.includes('timed out'))kind='timeout';
  else if(code==='SUPABASE_NETWORK_UNAVAILABLE'||String(input?.name||'')==='TypeError'||lower.includes('failed to fetch')||lower.includes('networkerror')||lower.includes('load failed'))kind='network';
  const retryAfterHeader=Number(response?.headers?.get?.('retry-after'));
  const retryAfterMs=Number(input?.retryAfterMs)||(Number.isFinite(retryAfterHeader)&&retryAfterHeader>0?retryAfterHeader*1000:null);
  return {kind,code:code||null,status,retryAfterMs:retryAfterMs||null,original:input};
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
  async function drain(){if(running)return;running=true;try{for(;;){const item=choose();if(!item)break;if(item.key)coalesced.delete(item.key);try{if(!canRun(item))throw item.blockedError();item.resolve(await item.task())}catch(error){item.reject(error)}}}finally{running=false;if(high.length||low.length)queueMicrotask(drain)}}
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

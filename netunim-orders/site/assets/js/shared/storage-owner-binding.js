// @ts-check
import {readStorageState} from './storage-operation.js';
import {equalSyncJson} from './sync-json.js';

/**
 * @typedef {import('./storage-json.js').StorageJsonObject} State
 * @typedef {'orders'|'kupa'} App
 * @typedef {'upload-local'|'load-account'|'logout-to-local'|'account-switch'} Intent
 * @typedef {'freezing-source'|'source-settled'|'target-authenticated'|'target-recovered'|'target-active'|'complete'} Phase
 * @typedef {State & {id:string,targetOwner:string,intent:'upload-local'|'load-account'}} Reservation
 * @typedef {State & {version:1,app:App,owner:string,generation:number,source:string,pendingAdoption?:Reservation|null}} Binding
 * @typedef {State & {version:1,app:App,id:string,sourceOwner:string,targetOwner:string,intent:Intent,phase:Phase}} Handoff
 * @typedef {{binding:Binding|null,handoff:Handoff|null}} OwnerSnapshot
 * @typedef {{readOwnerState:(app:App)=>Promise<unknown>,readOwnerBinding:(app:App)=>Promise<unknown>,readOwnerHandoff:(app:App)=>Promise<unknown>,initializeOwnerBinding:(app:App,owner:string,details:State)=>Promise<unknown>,reserveLocalOwnerTarget:(app:App,owner:string,details:State)=>Promise<unknown>,adoptPreparedLocalOwner:(app:App,owner:string,details:State)=>Promise<unknown>,beginOwnerHandoff:(app:App,record:Handoff,version:State)=>Promise<unknown>,advanceOwnerHandoff:(app:App,id:string,from:Phase,to:Phase,patch:State,version:State)=>Promise<unknown>,activateOwnerHandoff:(app:App,id:string,owner:string,details:State)=>Promise<unknown>,completeOwnerHandoff:(app:App,id:string,owner:string,details:State)=>Promise<unknown>}} OwnerDb
 * @typedef {Error & {code?:string,storageOwner?:string,authOwner?:string,requiredOwner?:string}} OwnerError
 * @typedef {{app:unknown,db:OwnerDb,primary?:()=>boolean,storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>|null|undefined,now:()=>string,operationId:()=>string}} BindingOptions
 */
export const STORAGE_OWNER_UNBOUND='__storage-owner-unbound__';
const OWNER_CACHE_PREFIX='netunim-storage-active-owner:';
const phases=new Set(['freezing-source','source-settled','target-authenticated','target-recovered','target-active','complete']);
/** @type {Map<Phase,Phase>} */
const NEXT_PHASE=new Map([['freezing-source','source-settled'],['source-settled','target-authenticated'],['target-authenticated','target-recovered']]);
const immutable=new Set(['version','app','id','sourceOwner','targetOwner','intent','phase','createdAt']);
/** @param {unknown} value @returns {value is string} */
function identity(value){return typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=512&&value!==STORAGE_OWNER_UNBOUND}
/** @param {unknown} value @returns {App} */
function normalizeApp(value){if(value!=='orders'&&value!=='kupa')throw new Error('storage_owner_app_invalid');return value}
/** @param {unknown} value */
function normalizeOwner(value){if(typeof value!=='string'||!identity(value.trim()))throw new Error('storage_owner_invalid');return value.trim()}
/** @param {unknown} session */
function sessionIdentity(session){
  if(!session||typeof session!=='object'||!('user' in session))return '';
  const user=session.user;
  return user&&typeof user==='object'&&'id' in user&&typeof user.id==='string'?user.id.trim():'';
}
/** @param {unknown} app */
export function storageOwnerCacheKey(app){return OWNER_CACHE_PREFIX+normalizeApp(app)}
/** @param {unknown} owner */
export function storageOwnerReady(owner){return identity(owner)}
/** @param {State} value @returns {value is Reservation} */
function reservation(value){return identity(value.id)&&identity(value.targetOwner)&&value.targetOwner!=='local'&&(value.intent==='load-account'||value.intent==='upload-local')}
/** @param {State} data @param {App} app @returns {data is Binding} */
function bindingEvidence(data,app){
  if(data.version!==1||data.app!==app||!identity(data.owner)||typeof data.generation!=='number'||!Number.isSafeInteger(data.generation)||data.generation<1||!identity(data.source))throw new Error('storage_owner_binding_invalid');
  if(data.pendingAdoption!=null&&(data.owner!=='local'||!reservation(readStorageState(data.pendingAdoption))))throw new Error('storage_owner_reservation_invalid');
  return true;
}
/** @param {State} data @param {App} app @returns {data is Handoff} */
function handoffEvidence(data,app){
  if(data.version!==1||data.app!==app||!identity(data.id)||!identity(data.sourceOwner)||!identity(data.targetOwner)||data.sourceOwner===data.targetOwner||typeof data.phase!=='string'||!phases.has(data.phase))throw new Error('storage_owner_handoff_invalid');
  const valid=data.intent==='account-switch'&&data.sourceOwner!=='local'&&data.targetOwner!=='local'||data.intent==='logout-to-local'&&data.sourceOwner!=='local'&&data.targetOwner==='local'||(data.intent==='load-account'||data.intent==='upload-local')&&data.sourceOwner==='local'&&data.targetOwner!=='local';
  if(!valid)throw new Error('storage_owner_handoff_intent_invalid');
  for(const key of ['sourceProof','targetProof','preparationProof'])if(data[key]!==undefined)readStorageState(data[key]);
  return true;
}
/** @param {unknown} value @param {App} app @returns {Binding} */
export function readStorageOwnerBinding(value,app){const data=readStorageState(value);if(!bindingEvidence(data,app))throw new Error('storage_owner_binding_invalid');return structuredClone(data)}
/** @param {unknown} value @param {App} app @returns {Handoff|null} */
export function readStorageOwnerRecord(value,app){if(value==null)return null;const data=readStorageState(value);if(!handoffEvidence(data,app))throw new Error('storage_owner_handoff_invalid');return structuredClone(data)}
/** @param {unknown} value @param {unknown} pending @param {App} app */
export function readStorageOwnerPair(value,pending,app){
  const binding=readStorageOwnerBinding(value,app),record=readStorageOwnerRecord(pending,app);
  if(record&&record.phase!=='complete'&&binding.owner!==(record.phase==='target-active'?record.targetOwner:record.sourceOwner))throw new Error('storage_owner_handoff_owner_mismatch');
  return {binding,handoff:record?.phase==='complete'?null:record};
}

/** @param {unknown} raw @param {App} app @returns {OwnerSnapshot} */
export function readStorageOwnerSnapshot(raw,app){
  const data=readStorageState(raw);
  if(!Object.hasOwn(data,'binding')||!Object.hasOwn(data,'handoff'))throw new Error('storage_owner_snapshot_invalid');
  const binding=data.binding===null?null:readStorageOwnerBinding(data.binding,app),handoff=readStorageOwnerRecord(data.handoff,app);
  if(!binding&&handoff)throw new Error('storage_owner_binding_missing');
  if(binding)readStorageOwnerPair(binding,handoff,app);
  return {binding,handoff};
}
/** @param {Phase} phase */
export function nextStorageOwnerPhase(phase){return NEXT_PHASE.get(phase)}
/** @param {unknown} value */
export function readStorageOwnerPatch(value){const patch=readStorageState(value);if(Object.keys(patch).some(key=>immutable.has(key)))throw new Error('storage_owner_identity_override');return structuredClone(patch)}

// A rejected read, cache publication or uncertain write revokes authority until
// a complete durable pair is read again. Stored evidence is never repaired here.
/** @param {BindingOptions} options */
export function createStorageOwnerBinding({app,primary=()=>true,db,storage,now,operationId}){
  const scope=normalizeApp(app),cacheKey=storageOwnerCacheKey(scope);
  let owner=STORAGE_OWNER_UNBOUND,blocked=true,changing=false;
  /** @type {Binding|null} */ let binding=null;
  /** @type {Handoff|null} */ let handoff=null;
  /** @type {Promise<ReturnType<typeof status>>|null} */ let hydrating=null;
  const clearCache=()=>{try{storage?.removeItem(cacheKey)}catch{}};
  const block=()=>{blocked=true;clearCache()};
  /** @param {unknown} nextBinding @param {unknown} nextHandoff */
  function applyDurable(nextBinding,nextHandoff){
    const next=readStorageOwnerPair(nextBinding,nextHandoff,scope);
    if(storage){storage.setItem(cacheKey,next.binding.owner);if(storage.getItem(cacheKey)!==next.binding.owner)throw new Error('storage_owner_cache_failed')}
    binding=next.binding;handoff=next.handoff;owner=binding.owner;blocked=false;
  }
  /** @template T @param {()=>Promise<unknown>} work @param {(raw:unknown)=>T} accept @returns {Promise<T>} */
  async function write(work,accept){
    if(changing||hydrating)throw new Error('storage_owner_busy');
    changing=true;const expected=binding;
    try{const result=await work();if(!primary()||binding!==expected)throw new Error('storage_owner_changed_during_write');return accept(result)}
    catch(error){block();throw error}finally{changing=false}
  }
  /** @param {{initialOwner?:(()=>unknown)|null}} [options] */
  async function hydrate(options={}){
    if(!options||Object.keys(options).some(key=>key!=='initialOwner'))throw new Error('storage_owner_hydrate_options_invalid');
    if(changing)throw new Error('storage_owner_busy');
    if(hydrating)return hydrating;if(binding&&!blocked)return status();
    hydrating=(async()=>{
      try{
        const {binding:durable,handoff:pending}=readStorageOwnerSnapshot(await db.readOwnerState(scope),scope);
        if(durable!=null){applyDurable(durable,pending);return status()}
        if(pending!=null)throw new Error('storage_owner_binding_missing');
        clearCache();const initial=typeof options.initialOwner==='function'?await options.initialOwner():null;
        const candidate=initial==null||initial===''?'local':normalizeOwner(initial);
        const created=await db.initializeOwnerBinding(scope,candidate,{source:candidate==='local'?'local-bootstrap':'session-bootstrap',at:now()});
        if(readStorageOwnerBinding(created,scope).owner!==candidate)throw new Error('storage_owner_transition_changed');
        const latest=readStorageOwnerSnapshot(await db.readOwnerState(scope),scope);
        if(!latest.binding||!equalSyncJson(latest.binding,created))throw new Error('storage_owner_transition_changed');
        applyDurable(latest.binding,latest.handoff);return status();
      }catch(error){block();throw error}
    })().finally(()=>{hydrating=null});return hydrating;
  }
  async function refresh(){
    if(changing)throw new Error('storage_owner_busy');if(hydrating)return hydrating;
    blocked=true;
    hydrating=(async()=>{try{const {binding:durable,handoff:pending}=readStorageOwnerSnapshot(await db.readOwnerState(scope),scope);applyDurable(durable,pending);return status()}catch(error){block();throw error}})().finally(()=>{hydrating=null});
    return hydrating;
  }
  function current(){return owner}
  // Admission closes before the handoff write. Already accepted journal work
  // may finish for this verified generation while the source is being frozen.
  function captureCommitAuthority(){
    const accepted=binding&&{owner:binding.owner,generation:binding.generation};
    return ()=>!!accepted&&!blocked&&primary()&&binding?.owner===accepted.owner&&binding.generation===accepted.generation;
  }
  function generation(){if(!binding)throw new Error('storage_owner_not_ready');return binding.generation}
  function assertReady(){if(!binding||blocked)throw new Error('storage_owner_not_ready');if(changing||hydrating)throw new Error('storage_owner_busy');return owner}
  /** @param {unknown} authenticatedOwner @param {{allowMissing?:boolean}} [options] */
  function assertAuthenticatedOwner(authenticatedOwner,{allowMissing=false}={}){
    const active=assertReady(),authenticated=typeof authenticatedOwner==='string'?authenticatedOwner.trim():'',reserved=binding?.pendingAdoption||null;
    if(active==='local'&&!reserved)return true;
    const required=active==='local'?String(reserved?.targetOwner||'').trim():active;
    if(!authenticated){
      if(allowMissing)return false;
      /** @type {OwnerError} */
      const error=new Error('נדרשת התחברות מחדש לחשבון שמחזיק את הנתונים המקומיים');
      error.code='storage_owner_reauth_required';throw error;
    }
    if(authenticated!==required){
      /** @type {OwnerError} */
      const error=new Error(active==='local'?'התחיל מעבר עמיד לחשבון אחר. יש להתחבר לאותו חשבון כדי להשלים אותו לפני בחירת חשבון חדש.':'החשבון שהתחבר אינו החשבון שמחזיק את הנתונים המקומיים. יש להשלים מעבר חשבון מפורש לפני טעינת חשבון אחר.');
      error.code=active==='local'?'storage_owner_local_adoption_auth_mismatch':'storage_owner_auth_mismatch';
      error.storageOwner=active;error.authOwner=authenticated;error.requiredOwner=required;throw error;
    }
    return true;
  }

  /** @param {unknown} targetOwner @param {{intent?:unknown}} [options] */
  async function reserveLocalAdoption(targetOwner,{intent}={}){
    if(!primary())throw new Error('storage_owner_handoff_primary_required');const source=assertReady(),target=normalizeOwner(targetOwner);
    if(source===target)return status();
    if(source!=='local'||target==='local'||intent!=='load-account'&&intent!=='upload-local')throw new Error('storage_owner_handoff_required');
    if(handoff)throw new Error('storage_owner_handoff_pending');
    const existing=binding?.pendingAdoption;
    if(existing){if(existing.targetOwner!==target||existing.intent!==intent)throw new Error('storage_owner_local_adoption_reserved');return status()}
    const id=normalizeOwner(operationId()),previous=binding;
    await write(()=>db.reserveLocalOwnerTarget(scope,target,{id,intent,at:now(),expectedGeneration:generation()}),raw=>{
      const next=readStorageOwnerBinding(raw,scope);
      if(!previous||next.owner!==source||next.generation!==previous.generation||next.pendingAdoption?.id!==id||next.pendingAdoption.targetOwner!==target||next.pendingAdoption.intent!==intent)throw new Error('storage_owner_transition_changed');
      applyDurable(next,null);
    });return status();
  }
  /** @param {unknown} session @param {{allowMissing?:boolean}} [options] */
  function assertSessionOwner(session,options={}){return assertAuthenticatedOwner(sessionIdentity(session),options)}
  /** @param {unknown} session */
  function sessionMatches(session){try{return assertSessionOwner(session,{allowMissing:true})}catch{return false}}
  /** @param {unknown} targetOwner @param {{intent?:unknown,proof?:unknown}} [options] */
  async function adoptPreparedLocalOwner(targetOwner,{intent,proof={}}={}){
    if(!primary())throw new Error('storage_owner_handoff_primary_required');const source=assertReady(),target=normalizeOwner(targetOwner);
    if(source===target)return status();
    if(source!=='local'||target==='local'||intent!=='load-account'&&intent!=='upload-local')throw new Error('storage_owner_handoff_required');
    if(handoff)throw new Error('storage_owner_handoff_pending');
    const reservation=binding?.pendingAdoption,previous=binding;
    if(!reservation||reservation.targetOwner!==target||reservation.intent!==intent)throw new Error('storage_owner_local_adoption_not_reserved');
    const id=normalizeOwner(operationId()),evidence=structuredClone(readStorageState(proof));
    await write(()=>db.adoptPreparedLocalOwner(scope,target,{id,intent,proof:evidence,at:now(),expectedGeneration:generation()}),raw=>{
      const reply=readStorageState(raw),next=readStorageOwnerBinding(reply.binding,scope),completed=readStorageOwnerRecord(reply.handoff,scope);
      if(!previous||next.owner!==target||next.generation!==previous.generation+1||next.pendingAdoption!=null||!completed||completed.phase!=='complete'||completed.id!==id||completed.sourceOwner!==source||completed.targetOwner!==target||completed.intent!==intent||completed.reservationId!==reservation.id||!equalSyncJson(completed.preparationProof,evidence))throw new Error('storage_owner_transition_changed');
      applyDurable(next,completed);
    });return status();
  }
  /** @param {unknown} targetOwner @param {{intent?:unknown}} [options] */
  async function beginHandoff(targetOwner,{intent}={}){
    if(!primary())throw new Error('storage_owner_handoff_primary_required');const source=assertReady(),target=normalizeOwner(targetOwner);
    if(source===target)throw new Error('storage_owner_handoff_same_owner');if(handoff)throw new Error('storage_owner_handoff_pending');
    const reservation=binding?.pendingAdoption;
    if(reservation&&(reservation.targetOwner!==target||reservation.intent!==intent))throw new Error('storage_owner_local_adoption_reserved');
    const at=now(),expected=readStorageOwnerRecord({version:1,id:normalizeOwner(operationId()),app:scope,sourceOwner:source,targetOwner:target,intent,phase:'freezing-source',createdAt:at,updatedAt:at},scope);
    if(!expected)throw new Error('storage_owner_handoff_invalid');
    return write(()=>db.beginOwnerHandoff(scope,expected,{expectedGeneration:generation()}),raw=>{
      const next=readStorageOwnerRecord(raw,scope);if(!next||!equalSyncJson(next,expected))throw new Error('storage_owner_transition_changed');handoff=next;return structuredClone(next);
    });
  }
  /** @param {Phase} expectedPhase @param {State} [details] */
  async function advanceHandoff(expectedPhase,details={}){
    if(!primary())throw new Error('storage_owner_handoff_primary_required');assertReady();
    const prior=handoff,to=NEXT_PHASE.get(expectedPhase);if(!prior)throw new Error('storage_owner_handoff_missing');
    if(!to||prior.phase!==expectedPhase)throw new Error('storage_owner_handoff_phase_invalid');
    const patch=readStorageOwnerPatch(details);
    const expected={...prior,...patch,phase:to,updatedAt:now()};
    return write(()=>db.advanceOwnerHandoff(scope,prior.id,expectedPhase,to,{...patch,updatedAt:expected.updatedAt},{expectedGeneration:generation()}),raw=>{
      const next=readStorageOwnerRecord(raw,scope);if(!next||!equalSyncJson(next,expected))throw new Error('storage_owner_transition_changed');handoff=next;return structuredClone(next);
    });
  }
  /** @param {'target-active'|'complete'} phase */
  async function finishHandoff(phase){
    if(!primary())throw new Error('storage_owner_handoff_primary_required');assertReady();const prior=handoff,previous=binding;
    if(!prior||!previous||prior.phase!==(phase==='target-active'?'target-recovered':'target-active')||phase==='complete'&&owner!==prior.targetOwner)throw new Error('storage_owner_handoff_phase_invalid');
    const work=()=>phase==='target-active'?db.activateOwnerHandoff(scope,prior.id,prior.targetOwner,{at:now(),expectedGeneration:generation()}):db.completeOwnerHandoff(scope,prior.id,prior.targetOwner,{at:now(),expectedGeneration:generation()});
    await write(work,raw=>{
      const reply=readStorageState(raw),next=readStorageOwnerBinding(reply.binding,scope),record=readStorageOwnerRecord(reply.handoff,scope);
      if(!record||next.owner!==prior.targetOwner||next.generation!==previous.generation+(phase==='target-active'?1:0)||next.pendingAdoption!=null||record.phase!==phase||record.id!==prior.id||record.sourceOwner!==prior.sourceOwner||record.targetOwner!==prior.targetOwner||record.intent!==prior.intent)throw new Error('storage_owner_transition_changed');
      for(const key of Object.keys(prior))if(key!=='phase'&&key!=='updatedAt'&&!equalSyncJson(prior[key],record[key]))throw new Error('storage_owner_transition_changed');
      applyDurable(next,record);
    });return status();
  }
  function status(){return {ready:!!binding&&!blocked,owner,locked:blocked||changing||!!handoff,binding:binding&&structuredClone(binding),handoff:handoff&&structuredClone(handoff)}}
  return {hydrate,refresh,current,captureCommitAuthority,assertReady,assertAuthenticatedOwner,assertSessionOwner,sessionMatches,reserveLocalAdoption,adoptPreparedLocalOwner,beginHandoff,advanceHandoff,
    activateHandoff:()=>finishHandoff('target-active'),completeHandoff:()=>finishHandoff('complete'),status,
    get ready(){return !!binding&&!blocked},get writable(){return !!binding&&!blocked&&!changing&&!handoff},get locked(){return blocked||changing||!!handoff}};
}

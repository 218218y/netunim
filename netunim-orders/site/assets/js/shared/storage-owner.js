import {createStorageJournalDb} from './storage-journal-idb.js';

export const STORAGE_OWNER_UNBOUND='__storage-owner-unbound__';
const OWNER_CACHE_PREFIX='netunim-storage-active-owner:';
const VALID_APPS=new Set(['orders','kupa']);
const NEXT_PHASE=new Map([
  ['freezing-source','source-settled'],
  ['source-settled','target-authenticated'],
  ['target-authenticated','target-recovered'],
]);

function normalizeApp(app){const value=String(app||'').trim();if(!VALID_APPS.has(value))throw new Error('storage_owner_app_invalid');return value}
function normalizeOwner(owner,{allowUnbound=false}={}){
  const value=String(owner||'').trim();
  if(allowUnbound&&value===STORAGE_OWNER_UNBOUND)return value;
  if(!value||value.length>512||value===STORAGE_OWNER_UNBOUND)throw new Error('storage_owner_invalid');
  return value;
}
function sessionIdentity(session){return String(session?.user?.id||'').trim()}
export function storageOwnerCacheKey(app){return OWNER_CACHE_PREFIX+normalizeApp(app)}
export function storageOwnerReady(owner){const value=String(owner||'').trim();return !!value&&value!==STORAGE_OWNER_UNBOUND}

// The durable IndexedDB binding is authoritative. LocalStorage is only a
// synchronous cache after hydrate() verifies/repairs it from IndexedDB.
export function createStorageOwnerBinding({app,primary=()=>true,db=createStorageJournalDb(),storage=globalThis.localStorage,now=()=>new Date().toISOString(),operationId=()=>globalThis.crypto?.randomUUID?.()||`handoff-${Date.now()}-${Math.random().toString(16).slice(2)}`}={}){
  const scope=normalizeApp(app),cacheKey=storageOwnerCacheKey(scope);
  let owner=STORAGE_OWNER_UNBOUND,binding=null,handoff=null,hydrating=null;
  const writeCache=value=>{if(!storage)return;storage.setItem(cacheKey,value);if(storage.getItem(cacheKey)!==value)throw new Error('storage_owner_cache_failed')};
  const clearUnverifiedCache=()=>{try{storage?.removeItem(cacheKey)}catch{}}
  function applyDurable(nextBinding,nextHandoff=null){
    const durable=nextBinding&&structuredClone(nextBinding);if(!durable||durable.app!==scope||durable.version!==1)throw new Error('storage_owner_binding_invalid');
    owner=normalizeOwner(durable.owner);binding=durable;handoff=nextHandoff&&nextHandoff.phase!=='complete'?structuredClone(nextHandoff):null;writeCache(owner);return status();
  }
  async function legacyCandidate(legacyOwner){
    if(typeof legacyOwner!=='function')return 'local';
    const value=await legacyOwner();return String(value||'').trim()||'local';
  }
  async function hydrate({legacyOwner=null}={}){
    if(binding)return status();if(hydrating)return hydrating;
    hydrating=(async()=>{
      const durable=await db.readOwnerBinding(scope),pending=await db.readOwnerHandoff(scope);
      if(durable)return applyDurable(durable,pending);
      // A cache without its durable binding is never authority. This also makes
      // clearing LocalStorage harmless when IndexedDB still contains the owner.
      clearUnverifiedCache();
      const candidate=normalizeOwner(await legacyCandidate(legacyOwner));
      const created=await db.initializeOwnerBinding(scope,candidate,{source:candidate==='local'?'local-bootstrap':'legacy-session-bootstrap',at:now()});
      const resumed=await db.readOwnerHandoff(scope);return applyDurable(created,resumed);
    })().finally(()=>{hydrating=null});
    return hydrating;
  }
  async function refresh(){
    const durable=await db.readOwnerBinding(scope),pending=await db.readOwnerHandoff(scope);
    return applyDurable(durable,pending);
  }
  function current(){return owner}
  function assertReady(){if(!binding||!storageOwnerReady(owner))throw new Error('storage_owner_not_ready');return owner}
  function assertAuthenticatedOwner(authenticatedOwner,{allowMissing=false}={}){
    const active=assertReady(),authenticated=String(authenticatedOwner||'').trim(),reserved=binding?.pendingAdoption||null;
    if(active==='local'&&!reserved)return true;
    const required=active==='local'?String(reserved?.targetOwner||'').trim():active;
    if(!authenticated){if(allowMissing)return false;const error=new Error('נדרשת התחברות מחדש לחשבון שמחזיק את הנתונים המקומיים');error.code='storage_owner_reauth_required';throw error}
    if(authenticated!==required){const error=new Error(active==='local'?'התחיל מעבר עמיד לחשבון אחר. יש להתחבר לאותו חשבון כדי להשלים אותו לפני בחירת חשבון חדש.':'החשבון שהתחבר אינו החשבון שמחזיק את הנתונים המקומיים. יש להשלים מעבר חשבון מפורש לפני טעינת חשבון אחר.');error.code=active==='local'?'storage_owner_local_adoption_auth_mismatch':'storage_owner_auth_mismatch';error.storageOwner=active;error.authOwner=authenticated;error.requiredOwner=required;throw error}
    return true;
  }
  async function reserveLocalAdoption(targetOwner,{intent}={}){
    if(!primary())throw new Error('storage_owner_handoff_primary_required');const source=assertReady(),target=normalizeOwner(targetOwner),kind=String(intent||'').trim();
    if(source===target)return status();
    if(source!=='local'||target==='local'||!['load-account','upload-local'].includes(kind))throw new Error('storage_owner_handoff_required');
    if(handoff)throw new Error('storage_owner_handoff_pending');
    const existing=binding?.pendingAdoption||null;if(existing){if(existing.targetOwner!==target||existing.intent!==kind)throw new Error('storage_owner_local_adoption_reserved');return status()}
    const id=String(operationId()||'').trim();if(!id)throw new Error('storage_owner_handoff_operation_id_unavailable');
    const next=await db.reserveLocalOwnerTarget(scope,target,{id,intent:kind,at:now()});return applyDurable(next,null);
  }
  function assertSessionOwner(session,options={}){return assertAuthenticatedOwner(sessionIdentity(session),options)}
  function sessionMatches(session){try{return assertSessionOwner(session,{allowMissing:true})}catch{return false}}
  async function adoptPreparedLocalOwner(targetOwner,{intent,proof={}}={}){
    if(!primary())throw new Error('storage_owner_handoff_primary_required');const source=assertReady(),target=normalizeOwner(targetOwner),kind=String(intent||'').trim();
    if(source===target)return status();
    if(source!=='local'||target==='local'||!['load-account','upload-local'].includes(kind))throw new Error('storage_owner_handoff_required');
    if(handoff)throw new Error('storage_owner_handoff_pending');
    const reservation=binding?.pendingAdoption||null;if(!reservation||reservation.targetOwner!==target||reservation.intent!==kind)throw new Error('storage_owner_local_adoption_not_reserved');
    const id=String(operationId()||'').trim();if(!id)throw new Error('storage_owner_handoff_operation_id_unavailable');
    const result=await db.adoptPreparedLocalOwner(scope,target,{id,intent:kind,proof:structuredClone(proof),at:now()});
    return applyDurable(result.binding,result.handoff);
  }
  async function beginHandoff(targetOwner,{intent}={}){
    if(!primary())throw new Error('storage_owner_handoff_primary_required');const source=assertReady(),target=normalizeOwner(targetOwner),kind=String(intent||'').trim();
    if(source===target)throw new Error('storage_owner_handoff_same_owner');if(!['load-account','upload-local','logout-to-local','account-switch'].includes(kind))throw new Error('storage_owner_handoff_intent_invalid');
    if(handoff)throw new Error('storage_owner_handoff_pending');
    const record=await db.beginOwnerHandoff(scope,{version:1,id:String(operationId()),app:scope,sourceOwner:source,targetOwner:target,intent:kind,phase:'freezing-source',createdAt:now(),updatedAt:now()});
    handoff=record;return structuredClone(record);
  }
  async function advanceHandoff(expectedPhase,details={}){
    if(!primary())throw new Error('storage_owner_handoff_primary_required');assertReady();if(!handoff)throw new Error('storage_owner_handoff_missing');
    const from=String(expectedPhase||''),to=NEXT_PHASE.get(from);if(!to||handoff.phase!==from)throw new Error('storage_owner_handoff_phase_invalid');
    handoff=await db.advanceOwnerHandoff(scope,handoff.id,from,to,{...structuredClone(details),updatedAt:now()});return structuredClone(handoff);
  }
  async function activateHandoff(){
    if(!primary())throw new Error('storage_owner_handoff_primary_required');assertReady();if(!handoff||handoff.phase!=='target-recovered')throw new Error('storage_owner_handoff_phase_invalid');
    const result=await db.activateOwnerHandoff(scope,handoff.id,handoff.targetOwner,{at:now()});
    return applyDurable(result.binding,result.handoff);
  }
  async function completeHandoff(){
    if(!primary())throw new Error('storage_owner_handoff_primary_required');assertReady();if(!handoff||handoff.phase!=='target-active'||owner!==handoff.targetOwner)throw new Error('storage_owner_handoff_phase_invalid');
    const result=await db.completeOwnerHandoff(scope,handoff.id,handoff.targetOwner,{at:now()});
    return applyDurable(result.binding,result.handoff);
  }
  function status(){return {ready:!!binding,owner,locked:!!handoff,binding:binding&&structuredClone(binding),handoff:handoff&&structuredClone(handoff)}}
  return {hydrate,refresh,current,assertReady,assertAuthenticatedOwner,assertSessionOwner,sessionMatches,reserveLocalAdoption,adoptPreparedLocalOwner,beginHandoff,advanceHandoff,activateHandoff,completeHandoff,status,get ready(){return !!binding},get writable(){return !!binding&&!handoff},get locked(){return !!handoff}};
}

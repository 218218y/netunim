import {createStorageJournalDb} from './storage-journal-idb.js';

const PHASES=Object.freeze(['freezing-source','source-settled','bootstrap-complete','verified','complete']);
const NEXT=new Map(PHASES.slice(0,-1).map((phase,index)=>[phase,PHASES[index+1]]));
const VALID_APPS=new Set(['orders','kupa']);
const clone=value=>value==null?value:structuredClone(value);
function identity(value){const text=String(value||'').trim();if(!text||text.length>512)throw new Error('storage_cutover_owner_invalid');return text}
function assertRecord(record){
  if(!record||record.version!==1||!VALID_APPS.has(record.app)||record.scope!==`${record.app}:${record.owner}`||!String(record.id||'').trim()||!identity(record.owner)||!PHASES.includes(record.phase)||!String(record.createdAt||'').trim()||!String(record.updatedAt||'').trim())throw new Error('storage_cutover_preparation_invalid');
  return record;
}

// Durable production cutover gate. The first persisted phase freezes ordinary
// writers before any legacy drain or cloud discovery. A crash can therefore
// resume without reopening a V1 mutation window.
export function createStorageV2CutoverCoordinator({app,owner,primary=()=>true,db=createStorageJournalDb(),bootstrapExecutor,resumePendingBootstrap,freeze=async()=>{},discoverBootstrap,drainLegacy,verifyLegacyClean,verifyHeads,markCutover,verifyCutover,now=()=>new Date().toISOString(),operationId=()=>globalThis.crypto?.randomUUID?.()}={}){
  const site=String(app||'').trim();if(!VALID_APPS.has(site)||typeof owner!=='function'||typeof primary!=='function'||!bootstrapExecutor||typeof bootstrapExecutor.start!=='function'||[resumePendingBootstrap,freeze,discoverBootstrap,drainLegacy,verifyLegacyClean,verifyHeads,markCutover,verifyCutover].some(fn=>typeof fn!=='function'))throw new Error('storage_cutover_coordinator_configuration');
  let hydrated=false,cached=null,running=null;
  const scope=()=>`${site}:${identity(owner())}`;
  const sameScope=scoped=>{if(scope()!==scoped)throw new Error('storage_cutover_owner_changed')};
  const guard=scoped=>{if(!primary())throw new Error('storage_cutover_primary_required');sameScope(scoped)};
  const remember=record=>{hydrated=true;cached=record?assertRecord(record):null;return cached&&clone(cached)};
  async function hydrate(){const scoped=scope();const record=await db.readCutoverPreparation(scoped);sameScope(scoped);return remember(record)}
  async function begin(){
    const scoped=scope();guard(scoped);const existing=await db.readCutoverPreparation(scoped);guard(scoped);
    if(existing)return remember(existing);
    const id=String(operationId()||'').trim();if(!id)throw new Error('storage_cutover_operation_id_unavailable');const stamp=String(now());
    const record={version:1,scope:scoped,id,app:site,owner:identity(owner()),phase:'freezing-source',createdAt:stamp,updatedAt:stamp};
    const durable=await db.beginCutoverPreparation(scoped,record);guard(scoped);return remember(durable);
  }
  async function advance(expected,proof={}){
    const scoped=scope();guard(scoped);const current=cached||await db.readCutoverPreparation(scoped);guard(scoped);if(!current)throw new Error('storage_cutover_preparation_missing');assertRecord(current);
    const next=NEXT.get(expected);if(!next||current.phase!==expected)throw new Error('storage_cutover_preparation_phase_invalid');
    const updated=await db.advanceCutoverPreparation(scoped,current.id,expected,next,{...clone(proof),updatedAt:String(now())});guard(scoped);return remember(updated);
  }
  async function execute(record){
    let current=record;
    while(current){
      guard(current.scope);
      if(current.phase==='freezing-source'){
        // The durable preparation record already exists. Freeze fresh business
        // mutations before draining legacy pending work, but keep drain APIs
        // available so preparation cannot deadlock on an existing V1 outbox.
        await freeze(clone(current));guard(current.scope);
        const drainProof=await drainLegacy(clone(current));guard(current.scope);
        if(await verifyLegacyClean()!==true)throw new Error('storage_cutover_legacy_pending');
        current=await advance('freezing-source',{drainProof:clone(drainProof)});continue;
      }
      if(current.phase==='source-settled'){
        // Once a bootstrap group is durable, its remote-existence decision is
        // immutable. A first upload may have created one remote document before
        // crashing; rediscovery would mistake that side for pre-existing cloud
        // authority and reject the saved plan. Resume that exact group first.
        let group=await resumePendingBootstrap(clone(current));guard(current.scope);
        if(!group){
          const options=await discoverBootstrap(clone(current));guard(current.scope);
          // Bind the bootstrap group to this durable preparation before any
          // cloud side effect. This also identifies a completed group if the
          // process dies just before advancing source-settled.
          group=await bootstrapExecutor.start({...options,id:current.id});guard(current.scope);
        }
        if(group?.phase!=='complete')throw new Error('storage_cutover_bootstrap_incomplete');
        current=await advance('source-settled',{bootstrapId:group.id,bootstrapPlanHash:group.planHash});continue;
      }
      if(current.phase==='bootstrap-complete'){
        if(await verifyLegacyClean()!==true)throw new Error('storage_cutover_legacy_pending');
        const proof=await verifyHeads(clone(current));guard(current.scope);
        if(!proof||proof.clean!==true)throw new Error('storage_cutover_head_verification_failed');
        current=await advance('bootstrap-complete',{headProof:clone(proof)});continue;
      }
      if(current.phase==='verified'){
        // A durable verified phase can be stale after a crash. Re-read legacy
        // cleanliness and both V2 heads immediately before the irreversible
        // marker, rather than trusting proof captured by a previous process.
        if(await verifyLegacyClean()!==true)throw new Error('storage_cutover_legacy_pending');
        const finalProof=await verifyHeads(clone(current));guard(current.scope);
        if(!finalProof||finalProof.clean!==true)throw new Error('storage_cutover_head_verification_failed');
        await markCutover({verifyLegacyClean});guard(current.scope);
        if(await verifyCutover()!==true)throw new Error('storage_cutover_marker_verification_failed');
        current=await advance('verified',{finalHeadProof:clone(finalProof),markedAt:String(now())});continue;
      }
      if(current.phase==='complete')return current;
      throw new Error('storage_cutover_preparation_phase_invalid');
    }
    throw new Error('storage_cutover_preparation_missing');
  }
  async function run(){
    if(running)return running;
    running=(async()=>{const current=cached||await hydrate()||await begin();return execute(current)})().finally(()=>{running=null});return running;
  }
  return {hydrate,begin,run,get ready(){return hydrated},get preparing(){return !!cached&&cached.phase!=='complete'},get record(){return cached&&clone(cached)},get phases(){return PHASES}};
}

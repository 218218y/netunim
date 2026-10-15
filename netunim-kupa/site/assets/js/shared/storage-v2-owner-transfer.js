// @ts-check
import {readStorageState,readSharedChecksState,storageV2BootstrapStateHash} from './storage-operation.js';
import {equalSyncJson} from './sync-json.js';

/**
 * @typedef {import('./storage-json.js').StorageJsonObject} State
 * @typedef {'upload-local'|'load-account'|'account-switch'} Intent
 * @typedef {'freezing-source'|'source-settled'|'target-authenticated'|'target-recovered'|'target-active'} Phase
 * @typedef {{mainSeq:number,sharedSeq:number,mainHash:string,sharedHash:string}} SourceProof
 * @typedef {{mainRevision:number,sharedRevision:number,mainHash:string,sharedHash:string}} TargetSummary
 * @typedef {{version:1,app:string,id:string,sourceOwner:string,targetOwner:string,intent:Intent,phase:Phase,sourceProof?:SourceProof,targetProof?:TargetSummary,bootstrapId?:string}} Handoff
 * @typedef {{main:{state:State,seq:number,fullState?:State},shared:{state:State,seq:number}}} Source
 * @typedef {{clean:true,mainRevision:number,sharedRevision:number,mainState:State,sharedState:State}} TargetProof
 * @typedef {{app:string,sourceOwner:string,targetOwner:string,intent:Intent,transferId:string}} Context
 * @typedef {Context & {source:Source}} SourceContext
 * @typedef {{load:(ctx:SourceContext)=>Promise<unknown>,prepare:(ctx:SourceContext)=>Promise<unknown>,resume:(ctx:SourceContext)=>Promise<unknown>,verify:(ctx:Context)=>Promise<unknown>,mark:(ctx:Context)=>Promise<unknown>,verifyMarker:()=>Promise<unknown>}} DetachedTarget
 * @typedef {{current:()=>string,status:()=>{handoff:unknown,binding?:{pendingAdoption?:unknown}|null},beginHandoff:(owner:string,options:{intent:Intent})=>Promise<unknown>,advanceHandoff:(phase:Phase,details?:{sourceProof?:SourceProof,targetProof?:TargetSummary,bootstrapId?:string})=>Promise<unknown>,activateHandoff:()=>Promise<unknown>,completeHandoff:()=>Promise<unknown>}} OwnerBinding
 * @typedef {{owner:string,mainState:State,sharedState:State,mainRevision:number,sharedRevision:number}} Result
 * @typedef {{app:string,ownerBinding:OwnerBinding,primary?:()=>boolean,online?:()=>boolean,authOwner:()=>unknown,settleSource:(ctx:Context)=>Promise<unknown>,createDetachedTarget:(owner:string)=>DetachedTarget,installTargetView:(proof:Context & TargetProof)=>Promise<unknown>}} TransferOptions
 */
const INTENTS=new Set(['upload-local','load-account','account-switch']);
const PHASES=new Set(['freezing-source','source-settled','target-authenticated','target-recovered','target-active']);
/** @template T @param {T} value @returns {T} */
const clone=value=>structuredClone(value);
/** @param {unknown} value @returns {value is string} */
function identity(value){return typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=512}
/** @param {unknown} value @returns {value is number} */
function revision(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0}
/** @param {unknown} value @returns {value is string} */
function hash(value){return typeof value==='string'&&/^[0-9a-f]{64}$/.test(value)}
/** @param {State} value @returns {value is State & SourceProof} */
function sourceEvidence(value){return revision(value.mainSeq)&&revision(value.sharedSeq)&&hash(value.mainHash)&&hash(value.sharedHash)}
/** @param {State} value @returns {value is State & TargetSummary} */
function targetEvidence(value){return revision(value.mainRevision)&&revision(value.sharedRevision)&&hash(value.mainHash)&&hash(value.sharedHash)}
/** @param {State} data @param {string} app @returns {data is State & Handoff} */
function handoffEvidence(data,app){
  if(data.version!==1||data.app!==app||!identity(data.id)||!identity(data.sourceOwner)||!identity(data.targetOwner)||data.targetOwner==='local'||data.sourceOwner===data.targetOwner||typeof data.intent!=='string'||!INTENTS.has(data.intent)||typeof data.phase!=='string'||!PHASES.has(data.phase))throw new Error('storage_transfer_handoff_invalid');
  if(data.sourceOwner==='local'?data.intent==='account-switch':data.intent!=='account-switch')throw new Error('storage_transfer_intent_invalid');
  if(data.sourceProof!==undefined&&!sourceEvidence(readStorageState(data.sourceProof)))throw new Error('storage_transfer_source_proof_invalid');
  if(data.phase!=='freezing-source'&&data.sourceProof===undefined)throw new Error('storage_transfer_source_proof_required');
  if(data.targetProof!==undefined&&!targetEvidence(readStorageState(data.targetProof)))throw new Error('storage_transfer_target_proof_invalid');
  if((data.phase==='target-recovered'||data.phase==='target-active')&&(data.targetProof===undefined||data.bootstrapId!==data.id))throw new Error('storage_transfer_target_proof_required');
  if(data.phase!=='target-recovered'&&data.phase!=='target-active'&&(data.targetProof!==undefined||data.bootstrapId!==undefined))throw new Error('storage_transfer_target_proof_premature');
  return true;
}
// IDB/collaborator replies remain unknown until decoded. Project only authority
// fields so timestamps and unrelated persisted metadata cannot change policy.
/** @param {unknown} value @param {string} app @returns {Handoff} */
export function readStorageOwnerHandoff(value,app){
  const data=readStorageState(value);
  if(!handoffEvidence(data,app))throw new Error('storage_transfer_handoff_invalid');
  return {version:1,app:data.app,id:data.id,sourceOwner:data.sourceOwner,targetOwner:data.targetOwner,intent:data.intent,phase:data.phase,
    ...(data.sourceProof?{sourceProof:clone(data.sourceProof)}:{}),
    ...(data.targetProof?{targetProof:clone(data.targetProof),bootstrapId:data.id}:{})};
}
/** @param {unknown} value @returns {Source} */
function readSource(value){
  const source=readStorageState(value),main=readStorageState(source.main),shared=readStorageState(source.shared);
  if(!revision(main.seq)||!revision(shared.seq))throw new Error('storage_transfer_source_invalid');
  return {main:{state:readStorageState(main.state),seq:main.seq,...(main.fullState===undefined?{}:{fullState:readStorageState(main.fullState)})},
    shared:{state:readSharedChecksState(shared.state),seq:shared.seq}};
}
/** @param {Source} source @returns {Promise<SourceProof>} */
async function sourceProof(source){
  return {mainSeq:source.main.seq,sharedSeq:source.shared.seq,
    mainHash:await storageV2BootstrapStateHash('main',source.main.state),
    sharedHash:await storageV2BootstrapStateHash('shared',source.shared.state)};
}
/** @param {unknown} value @returns {TargetProof} */
function readTargetProof(value){
  const proof=readStorageState(value);
  if(proof.clean!==true||!revision(proof.mainRevision)||!revision(proof.sharedRevision))throw new Error('storage_transfer_target_unverified');
  return {clean:true,mainRevision:proof.mainRevision,sharedRevision:proof.sharedRevision,
    mainState:readStorageState(proof.mainState),sharedState:readSharedChecksState(proof.sharedState)};
}
/** @param {unknown} value @param {Handoff} record @returns {State & {id:string}} */
function assertPlan(value,record){
  const group=readStorageState(value);
  if(!identity(group.id)||group.id!==record.id||group.owner!==record.targetOwner||group.sourceOwner!==record.sourceOwner||group.transferIntent!==record.intent)throw new Error('storage_transfer_bootstrap_plan_mismatch');
  const main=readStorageState(group.main),shared=readStorageState(group.shared);
  if(!record.sourceProof||main.sourceSeq!==record.sourceProof.mainSeq||shared.sourceSeq!==record.sourceProof.sharedSeq||main.sourceHash!==record.sourceProof.mainHash||shared.sourceHash!==record.sourceProof.sharedHash)throw new Error('storage_transfer_bootstrap_source_mismatch');
  return {...group,id:group.id};
}
/** @param {Handoff} record @param {string} app @returns {Context} */
function context(record,app){return {app,sourceOwner:record.sourceOwner,targetOwner:record.targetOwner,intent:record.intent,transferId:record.id}}

// The durable handoff locks business writes before detached target work starts.
// Each phase transition must retain the same source and target evidence.
/** @param {TransferOptions} options */
export function createStorageV2OwnerTransfer({app,ownerBinding,primary=()=>true,online=()=>true,authOwner,settleSource,createDetachedTarget,installTargetView}){
  if(!['orders','kupa'].includes(app)||!ownerBinding||[primary,online,authOwner,settleSource,createDetachedTarget,installTargetView,ownerBinding.current,ownerBinding.status,ownerBinding.beginHandoff,ownerBinding.advanceHandoff,ownerBinding.activateHandoff,ownerBinding.completeHandoff].some(fn=>typeof fn!=='function'))throw new Error('storage_transfer_configuration');
  /** @type {Handoff|null} */ let record=null;
  /** @type {Promise<Result|null>|null} */ let running=null;
  function status(){return ownerBinding.status()}
  function pending(){const value=status().handoff;return value==null?null:readStorageOwnerHandoff(value,app)}
  /** @param {Handoff} current @param {Phase} [phase] @returns {Handoff} */
  function sameRecord(current,phase=current.phase){
    const latest=pending();
    if(!latest||!equalSyncJson(latest,{...current,phase}))throw new Error('storage_transfer_handoff_changed');
    return latest;
  }
  /** @param {Handoff} current @param {{active?:boolean}} [options] */
  function guard(current,{active=false}={}){
    if(!primary())throw new Error('storage_transfer_primary_required');
    const latest=sameRecord(current),expected=active?current.targetOwner:current.sourceOwner;
    if(ownerBinding.current()!==expected)throw new Error('storage_transfer_owner_changed');
    if(authOwner()!==current.targetOwner)throw new Error('storage_transfer_target_reauth_required');
    if(!online())throw new Error('storage_transfer_online_required');
    return latest;
  }
  /** @param {Handoff} current @param {Phase} phase @param {{sourceProof?:SourceProof,targetProof?:TargetSummary,bootstrapId?:string}} [details] */
  async function advance(current,phase,details={}){
    const next=readStorageOwnerHandoff(await ownerBinding.advanceHandoff(current.phase,details),app);
    if(!equalSyncJson(next,{...current,...details,phase}))throw new Error('storage_transfer_transition_changed');
    sameRecord(next);record=next;return next;
  }
  /** @param {Handoff} current */
  async function captureSource(current){
    guard(current);
    const source=clone(readSource(await settleSource(context(current,app))));guard(current);
    const proof=await sourceProof(source);guard(current);
    if(current.sourceProof&&!equalSyncJson(proof,current.sourceProof))throw new Error('storage_transfer_source_changed');
    return {source,proof};
  }
  /** @param {DetachedTarget} target @param {Handoff} current */
  async function verifyTarget(target,current){
    const active=current.phase==='target-active';guard(current,{active});
    const proof=clone(readTargetProof(await target.verify(context(current,app))));guard(current,{active});
    const summary={mainRevision:proof.mainRevision,sharedRevision:proof.sharedRevision,
      mainHash:await storageV2BootstrapStateHash('main',proof.mainState),
      sharedHash:await storageV2BootstrapStateHash('shared',proof.sharedState)};
    guard(current,{active});
    if(current.targetProof&&!equalSyncJson(summary,current.targetProof))throw new Error('storage_transfer_target_changed');
    return {proof,summary};
  }
  /** @param {Handoff} initial @returns {Promise<Result>} */
  async function execute(initial){
    let current=initial;
    guard(current,{active:current.phase==='target-active'});
    const target=createDetachedTarget(current.targetOwner);
    if(!target||[target.load,target.prepare,target.resume,target.verify,target.mark,target.verifyMarker].some(fn=>typeof fn!=='function'))throw new Error('storage_transfer_detached_target_required');
    for(;;){
      if(current.phase==='freezing-source'){
        const {proof}=await captureSource(current);
        current=await advance(current,'source-settled',{sourceProof:proof});continue;
      }
      if(current.phase==='source-settled'){
        await captureSource(current);guard(current);
        current=await advance(current,'target-authenticated');continue;
      }
      if(current.phase==='target-authenticated'){
        const {source}=await captureSource(current),ctx={...context(current,app),source};
        // Resume our immutable plan before rediscovery can misclassify a
        // document created immediately before a lost ACK or process crash.
        const loaded=await target.load(ctx);guard(current);
        const saved=loaded==null?null:readStorageState(loaded);
        if(saved&&saved.phase!=='complete')assertPlan(saved,current);
        let group=saved?.id===current.id?(saved.phase==='complete'?saved:await target.resume(ctx)):null;guard(current);
        if(!group)group=await target.prepare(ctx);guard(current);
        const plan=assertPlan(group,current);
        if(plan.phase!=='complete')throw new Error('storage_transfer_bootstrap_incomplete');
        const first=await verifyTarget(target,current);
        await target.mark(context(current,app));guard(current);
        if(await target.verifyMarker()!==true)throw new Error('storage_transfer_marker_unverified');guard(current);
        const final=await verifyTarget(target,current);
        if(!equalSyncJson(first.summary,final.summary))throw new Error('storage_transfer_target_changed');
        current=await advance(current,'target-recovered',{bootstrapId:plan.id,targetProof:final.summary});continue;
      }
      if(current.phase==='target-recovered'){
        guard(current);
        if(await target.verifyMarker()!==true)throw new Error('storage_transfer_marker_unverified');guard(current);
        await verifyTarget(target,current);
        await ownerBinding.activateHandoff();current=sameRecord(current,'target-active');record=current;continue;
      }
      if(current.phase==='target-active'){
        guard(current,{active:true});
        if(await target.verifyMarker()!==true)throw new Error('storage_transfer_marker_unverified');guard(current,{active:true});
        const {proof}=await verifyTarget(target,current);
        await installTargetView({...context(current,app),...proof});guard(current,{active:true});
        await ownerBinding.completeHandoff();
        if(status().handoff!=null||ownerBinding.current()!==current.targetOwner)throw new Error('storage_transfer_completion_changed');
        record=null;
        return {owner:current.targetOwner,mainState:clone(proof.mainState),sharedState:clone(proof.sharedState),mainRevision:proof.mainRevision,sharedRevision:proof.sharedRevision};
      }
      throw new Error('storage_transfer_phase_invalid');
    }
  }
  async function hydrate(){record=pending();return clone(record)}
  async function resume(){
    if(running)return running;
    running=(async()=>{const value=await hydrate();return value?execute(value):null})().finally(()=>{running=null});return running;
  }
  /** @param {{targetOwner:unknown,intent:unknown}} options */
  async function start({targetOwner,intent}){
    if(!identity(targetOwner)||targetOwner==='local')throw new Error('storage_transfer_account_required');
    if(intent!=='upload-local'&&intent!=='load-account'&&intent!=='account-switch')throw new Error('storage_transfer_intent_invalid');
    const target=targetOwner,kind=intent,source=ownerBinding.current();
    if(running){const active=pending();if(active?.targetOwner===target&&active.intent===kind)return running;throw new Error('storage_transfer_handoff_pending')}
    const existing=pending();
    if(existing){if(existing.targetOwner!==target||existing.intent!==kind)throw new Error('storage_transfer_handoff_pending');return resume()}
    if(source===target)throw new Error('storage_transfer_same_owner');
    if(source==='local'?kind==='account-switch':kind!=='account-switch')throw new Error('storage_transfer_intent_invalid');
    if(!primary())throw new Error('storage_transfer_primary_required');
    if(authOwner()!==target)throw new Error('storage_transfer_target_reauth_required');
    if(!online())throw new Error('storage_transfer_online_required');
    if(status().binding?.pendingAdoption)throw new Error('storage_transfer_reservation_pending');
    running=(async()=>{
      const begun=readStorageOwnerHandoff(await ownerBinding.beginHandoff(target,{intent:kind}),app);
      if(begun.sourceOwner!==source||begun.targetOwner!==target||begun.intent!==kind||begun.phase!=='freezing-source')throw new Error('storage_transfer_transition_changed');
      record=begun;return execute(begun);
    })().finally(()=>{running=null});return running;
  }
  return {hydrate,start,resume,get preparing(){return !!running||!!record||status().handoff!=null},get record(){return clone(record||pending())}};
}

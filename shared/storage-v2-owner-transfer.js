import {storageV2BootstrapStateHash} from './storage-v2-bootstrap.js';
import {assertStorageJson} from './storage-journal-model.js';

const INTENTS=new Set(['upload-local','load-account','account-switch']);
const clone=value=>value==null?value:structuredClone(value);

function identity(value){
  const text=String(value||'').trim();
  if(!text||text==='local'||text.length>512)throw new Error('storage_transfer_account_required');
  return text;
}
function revision(value){
  return Number.isSafeInteger(value)&&value>=0?value:null;
}
function assertSource(source){
  if(!source||!source.main||!source.shared)throw new Error('storage_transfer_source_missing');
  for(const side of [source.main,source.shared]){
    if(revision(side.seq)===null||!side.state||typeof side.state!=='object'||Array.isArray(side.state))throw new Error('storage_transfer_source_invalid');
    assertStorageJson(side.state);
  }
  if(!Array.isArray(source.shared.state.checks)||!Array.isArray(source.shared.state.bankEvents))throw new Error('storage_transfer_shared_source_invalid');
  return source;
}
async function sourceProof(source){
  assertSource(source);
  return {mainSeq:source.main.seq,sharedSeq:source.shared.seq,
    mainHash:await storageV2BootstrapStateHash('main',source.main.state),
    sharedHash:await storageV2BootstrapStateHash('shared',source.shared.state)};
}
async function assertTargetProof(proof){
  if(!proof||proof.clean!==true||revision(proof.mainRevision)===null||revision(proof.sharedRevision)===null||!proof.mainState||!proof.sharedState||!Array.isArray(proof.sharedState.checks)||!Array.isArray(proof.sharedState.bankEvents))throw new Error('storage_transfer_target_unverified');
  assertStorageJson(proof.mainState);assertStorageJson(proof.sharedState);
  return {mainRevision:proof.mainRevision,sharedRevision:proof.sharedRevision,
    mainHash:await storageV2BootstrapStateHash('main',proof.mainState),
    sharedHash:await storageV2BootstrapStateHash('shared',proof.sharedState)};
}
function assertPlan(group,record){
  if(!group||group.id!==record.id||group.owner!==record.targetOwner||group.sourceOwner!==record.sourceOwner||group.transferIntent!==record.intent)throw new Error('storage_transfer_bootstrap_plan_mismatch');
  if(record.sourceProof&&(group.main.sourceSeq!==record.sourceProof.mainSeq||group.shared.sourceSeq!==record.sourceProof.sharedSeq||group.main.sourceHash!==record.sourceProof.mainHash||group.shared.sourceHash!==record.sourceProof.sharedHash))throw new Error('storage_transfer_bootstrap_source_mismatch');
}
function assertGroup(group,record){assertPlan(group,record);if(group.phase!=='complete')throw new Error('storage_transfer_bootstrap_incomplete')}

// A handoff is durable before any cloud work starts. The caller supplies a
// fixed-owner detached target: it must never use the active owner callback or
// publish into the visible model while prepare/resume/verify are running.
// Both local->account and account A->B use the same owner-handoff transaction,
// keeping business writes locked until the target view has been installed.
export function createStorageV2OwnerTransfer({app,ownerBinding,primary=()=>true,online=()=>true,authOwner,settleSource,createDetachedTarget,installTargetView}={}){
  if(!['orders','kupa'].includes(app)||!ownerBinding||[primary,online,authOwner,settleSource,createDetachedTarget,installTargetView,ownerBinding.current,ownerBinding.status,ownerBinding.beginHandoff,ownerBinding.advanceHandoff,ownerBinding.activateHandoff,ownerBinding.completeHandoff].some(fn=>typeof fn!=='function'))throw new Error('storage_transfer_configuration');
  let record=null,running=null;
  function status(){return ownerBinding.status()}
  function sameRecord(current){
    const latest=status().handoff;
    if(!latest||latest.id!==current.id||latest.sourceOwner!==current.sourceOwner||latest.targetOwner!==current.targetOwner||latest.intent!==current.intent)throw new Error('storage_transfer_handoff_changed');
    return latest;
  }
  function guard(current,{active=false}={}){
    if(!primary())throw new Error('storage_transfer_primary_required');
    const latest=sameRecord(current),expected=active?current.targetOwner:current.sourceOwner;
    if(ownerBinding.current()!==expected)throw new Error('storage_transfer_owner_changed');
    if(String(authOwner()||'').trim()!==current.targetOwner)throw new Error('storage_transfer_target_reauth_required');
    if(!online())throw new Error('storage_transfer_online_required');
    return latest;
  }
  async function captureSource(current){
    guard(current);const source=clone(assertSource(await settleSource({app,sourceOwner:current.sourceOwner,targetOwner:current.targetOwner,intent:current.intent,transferId:current.id})));guard(current);
    const proof=await sourceProof(source);guard(current);
    if(current.sourceProof&&JSON.stringify(proof)!==JSON.stringify(current.sourceProof))throw new Error('storage_transfer_source_changed');
    return {source,proof};
  }
  async function verifyTarget(target,current){
    guard(current,{active:current.phase==='target-active'});
    const proof=clone(await target.verify({app,sourceOwner:current.sourceOwner,targetOwner:current.targetOwner,intent:current.intent,transferId:current.id}));
    guard(current,{active:current.phase==='target-active'});
    const summary=await assertTargetProof(proof);
    guard(current,{active:current.phase==='target-active'});
    return {proof,summary};
  }
  async function execute(initial){
    let current=initial;
    guard(current,{active:current.phase==='target-active'});
    const target=createDetachedTarget(current.targetOwner);
    if(!target||[target.load,target.prepare,target.resume,target.verify,target.mark,target.verifyMarker].some(fn=>typeof fn!=='function'))throw new Error('storage_transfer_detached_target_required');
    while(current){
      if(current.phase==='freezing-source'){
        const {proof}=await captureSource(current);
        current=await ownerBinding.advanceHandoff('freezing-source',{sourceProof:proof});record=current;continue;
      }
      if(current.phase==='source-settled'){
        await captureSource(current);guard(current);
        current=await ownerBinding.advanceHandoff('source-settled');record=current;continue;
      }
      if(current.phase==='target-authenticated'){
        const {source}=await captureSource(current);
        // Resume the immutable target-scoped bootstrap before discovery. A
        // first upload may have created Main remotely immediately before a
        // crash, and rediscovering it would misclassify our own document.
        const context={app,sourceOwner:current.sourceOwner,targetOwner:current.targetOwner,intent:current.intent,transferId:current.id,source};
        const saved=await target.load(context);guard(current);
        if(saved&&saved.phase!=='complete')assertPlan(saved,current);
        let group=saved?.id===current.id?(saved.phase==='complete'?saved:await target.resume(context)):null;guard(current);
        if(!group)group=await target.prepare(context);guard(current);
        assertGroup(group,current);
        const first=await verifyTarget(target,current);
        await target.mark({app,sourceOwner:current.sourceOwner,targetOwner:current.targetOwner,intent:current.intent,transferId:current.id});guard(current);
        if(await target.verifyMarker()!==true)throw new Error('storage_transfer_marker_unverified');guard(current);
        const final=await verifyTarget(target,current);
        if(JSON.stringify(first.summary)!==JSON.stringify(final.summary))throw new Error('storage_transfer_target_changed');
        current=await ownerBinding.advanceHandoff('target-authenticated',{bootstrapId:group.id,targetProof:final.summary});record=current;continue;
      }
      if(current.phase==='target-recovered'){
        guard(current);
        if(await target.verifyMarker()!==true)throw new Error('storage_transfer_marker_unverified');guard(current);
        await verifyTarget(target,current);
        // The owner and handoff phase change in one IndexedDB transaction.
        // The handoff remains locked until the detached view is installed.
        await ownerBinding.activateHandoff();current=sameRecord(current);record=current;continue;
      }
      if(current.phase==='target-active'){
        guard(current,{active:true});
        if(await target.verifyMarker()!==true)throw new Error('storage_transfer_marker_unverified');guard(current,{active:true});
        const {proof}=await verifyTarget(target,current);
        await installTargetView({app,targetOwner:current.targetOwner,intent:current.intent,transferId:current.id,...proof});guard(current,{active:true});
        await ownerBinding.completeHandoff();record=null;
        return {owner:current.targetOwner,mainState:clone(proof.mainState),sharedState:clone(proof.sharedState),mainRevision:proof.mainRevision,sharedRevision:proof.sharedRevision};
      }
      throw new Error('storage_transfer_phase_invalid');
    }
    throw new Error('storage_transfer_handoff_missing');
  }
  async function hydrate(){record=status().handoff||null;return clone(record)}
  async function resume(){
    if(running)return running;
    running=(async()=>{const pending=await hydrate();if(!pending)return null;
      if(!INTENTS.has(pending.intent)||pending.targetOwner==='local')throw new Error('storage_transfer_handoff_unsupported');
      return execute(pending);
    })().finally(()=>{running=null});return running;
  }
  async function start({targetOwner,intent}={}){
    const target=identity(targetOwner),kind=String(intent||'').trim(),source=ownerBinding.current();
    if(running){const active=status().handoff;if(active?.targetOwner===target&&active?.intent===kind)return running;throw new Error('storage_transfer_handoff_pending')}
    const existing=status().handoff;
    if(existing){if(existing.targetOwner!==target||existing.intent!==kind)throw new Error('storage_transfer_handoff_pending');return resume()}
    if(source===target)throw new Error('storage_transfer_same_owner');
    if(!INTENTS.has(kind)||source==='local'&&kind==='account-switch'||source!=='local'&&kind!=='account-switch')throw new Error('storage_transfer_intent_invalid');
    if(!primary())throw new Error('storage_transfer_primary_required');
    if(String(authOwner()||'').trim()!==target)throw new Error('storage_transfer_target_reauth_required');
    if(!online())throw new Error('storage_transfer_online_required');
    const binding=status();if(binding.binding?.pendingAdoption)throw new Error('storage_transfer_legacy_reservation_pending');
    running=(async()=>{
      const begun=await ownerBinding.beginHandoff(target,{intent:kind});record=begun;
      return execute(begun);
    })().finally(()=>{running=null});return running;
  }
  return {hydrate,start,resume,get preparing(){return !!running||!!record||!!status().handoff},get record(){return clone(record||status().handoff)}};
}

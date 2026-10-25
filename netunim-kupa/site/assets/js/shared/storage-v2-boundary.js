import {createStorageJournalDb} from './storage-journal-idb.js';
import {readStorageBoundary} from './storage-operation.js';
import {equalSyncJson} from './cloud-sync.js';

const phases=['prepared','shared-applied','main-applied'];
const copy=structuredClone;
const business=state=>{const value=copy(state);delete value._meta;return value};

// Rare full-state operations span two otherwise independent journals. The
// durable intent is written first; each side records the same boundary ID in
// its checkpoint. Recovery can finish a crash at every phase without applying
// a restore twice or mistaking an old visible model for a new account.
export function createStorageV2Boundary({owner,primary,main,shared,validateMainCloud=()=>{},db=createStorageJournalDb(),now=()=>new Date().toISOString()}={}){
  if([owner,primary,validateMainCloud].some(value=>typeof value!=='function')||!main||!shared)throw new Error('storage_boundary_configuration');
  let running=null,lockedOwner='';
  const identity=()=>String(owner()||'').trim();
  const guard=scoped=>{if(!primary()||identity()!==scoped)throw new Error('storage_boundary_owner_changed')};
  const unlock=scoped=>{if(lockedOwner===scoped)lockedOwner=''};
  function validate(record,scoped){
    const decoded=readStorageBoundary(record,scoped);
    if(!decoded||decoded.phase!=='prepared')throw new Error('storage_boundary_invalid');
    return decoded;
  }
  function read(record,scoped,expected={}){
    const decoded=readStorageBoundary(record,scoped);
    if(expected.id!==undefined&&(!decoded||decoded.id!==expected.id||decoded.phase!==expected.phase))throw new Error('storage_boundary_transition_changed');
    if(expected.intent&&decoded&&(decoded.kind!==expected.intent.kind||decoded.phase!=='complete'&&(!equalSyncJson(decoded.main,expected.intent.main)||!equalSyncJson(decoded.shared,expected.intent.shared))))throw new Error('storage_boundary_transition_changed');
    return decoded;
  }
  async function apply(action,runtime,id,side,scoped){
    guard(scoped);
    const recovered=await runtime.recover();guard(scoped);
    if(!recovered)throw new Error('storage_boundary_journal_missing');
    if(recovered.appMetadata?.boundaryId===id)return;
    let result;
    if(action.kind==='replace-local-with-pending')result=side==='main'
      ?await runtime.replaceLocalWithPending(action.state,{boundaryId:id,expectedSeq:action.expectedSeq,expectedBaseRevision:action.expectedBaseRevision,validateBase:validateMainCloud})
      :await runtime.replaceLocalWithPending(action.state,{boundaryId:id,expectedSeq:action.expectedSeq,expectedBaseRevision:action.expectedBaseRevision});
    else if(action.kind==='replace-local-authoritative')result=await runtime.replaceLocalAuthoritativeState(action.state,{boundaryId:id,expectedSeq:action.expectedSeq});
    else if(action.kind==='reset-cloud-head')result=side==='main'
      ?await runtime.resetCloudHead(action.revision,action.cloudState||action.state,action.state,{...action.options,validateBase:validateMainCloud,appMetadata:{boundaryId:id,...action.options?.appMetadata}})
      :await runtime.resetCloudHead(action.revision,action.state,{boundaryId:id});
    else result=side==='main'
      ?await runtime.replaceAuthoritativeState(action.state,{...action.options,appMetadata:{boundaryId:id,...action.options?.appMetadata}})
      :await runtime.replaceAuthoritativeState(action.state,{boundaryId:id});
    if(result===false||result==null)throw new Error('storage_boundary_apply_failed');
  }
  async function resume(){
    const scoped=identity();guard(scoped);
    if(running?.owner===scoped)return running.promise;
    if(running)throw new Error('storage_boundary_busy');
    const work=(async()=>{
      let record=await db.readBoundary(scoped);guard(scoped);
      if(record)lockedOwner=scoped;
      record=read(record,scoped);
      if(!record||record.phase==='complete'){unlock(scoped);return record}
      lockedOwner=scoped;
      read(record,scoped);
      if(record.phase==='prepared'){
        await apply(record.shared,shared,record.id,'shared',scoped);guard(scoped);
        const id=record.id,intent=record;
        record=await db.advanceBoundary(scoped,id,'prepared','shared-applied');guard(scoped);
        record=read(record,scoped,{id,phase:'shared-applied',intent});
      }
      if(record.phase==='shared-applied'){
        await apply(record.main,main,record.id,'main',scoped);guard(scoped);
        const id=record.id,intent=record;
        record=await db.advanceBoundary(scoped,id,'shared-applied','main-applied');guard(scoped);
        record=read(record,scoped,{id,phase:'main-applied',intent});
      }
      if(record.phase==='main-applied'){
        const id=record.id,intent=record;
        await db.completeBoundary(scoped,id);guard(scoped);
        record=await db.readBoundary(scoped);guard(scoped);
        record=read(record,scoped,{id,phase:'complete',intent});
      }
      unlock(scoped);
      return record;
    })();running={owner:scoped,promise:work};try{return await work}finally{if(running?.promise===work)running=null}
  }
  async function run({id,kind,main:mainAction,shared:sharedAction}={}){
    const scoped=identity();guard(scoped);
    const record=validate({version:2,owner:scoped,id,kind,phase:'prepared',preparedAt:now(),main:copy(mainAction),shared:copy(sharedAction)},scoped);
    lockedOwner=scoped;
    let durableIntent=false;
    try{
    const raw=await db.readBoundary(scoped);guard(scoped);
    if(raw)durableIntent=true;
    const existing=read(raw,scoped);
    durableIntent=!!existing&&existing.phase!=='complete';
    if(existing?.phase==='complete'&&existing.id===id){
      const [mainRecovered,sharedRecovered]=await Promise.all([main.recover(),shared.recover()]);guard(scoped);
      const completedSeq=action=>action.kind==='replace-local-with-pending'?action.expectedSeq+1:action.kind==='replace-local-authoritative'?action.expectedSeq:0;
      const expectedMainSeq=completedSeq(record.main),expectedSharedSeq=completedSeq(record.shared);
      if(mainRecovered?.appMetadata?.boundaryId!==id||sharedRecovered?.appMetadata?.boundaryId!==id||mainRecovered.seq!==expectedMainSeq||sharedRecovered.seq!==expectedSharedSeq||!equalSyncJson(business(mainRecovered.state),business(record.main.state))||!equalSyncJson(sharedRecovered.state,record.shared.state))throw new Error('storage_boundary_completed_state_changed');
      unlock(scoped);return existing;
    }
    if(existing&&existing.phase!=='complete'){durableIntent=true;if(existing.id!==id)throw new Error('storage_boundary_pending')}
    if(!existing||existing.phase==='complete'){
      // Freeze ordinary edits before checking the versions used to construct
      // the restore. A stale target must never become a durable intent.
      for(const [action,runtime] of [[record.shared,shared],[record.main,main]]){
        if(action.expectedSeq===undefined)continue;
        const recovered=await runtime.recover();guard(scoped);guard(scoped);
        if(!recovered||recovered.seq!==action.expectedSeq)throw new Error('storage_boundary_source_changed');
        if(action.requireCleanCloud){const cloud=await runtime.cloudState();guard(scoped);if(!cloud?.base||cloud.pending||cloud.flight||cloud.control||action.expectedBaseRevision!==undefined&&cloud.base.revision!==action.expectedBaseRevision)throw new Error('storage_boundary_cloud_changed')}
        if(action.kind==='replace-local-authoritative'){const cloud=await runtime.cloudState();guard(scoped);if(cloud?.base||cloud?.flight||cloud?.control)throw new Error('storage_boundary_local_cloud_head_exists')}
      }
      await db.beginBoundary(scoped,record);
      durableIntent=true;
    }
    guard(scoped);return resume();
    }catch(error){if(!durableIntent)unlock(scoped);throw error}
  }
  async function pending(){const scoped=identity();guard(scoped);const raw=await db.readBoundary(scoped);guard(scoped);if(raw)lockedOwner=scoped;const record=read(raw,scoped);if(!record||record.phase==='complete')unlock(scoped);return !!record&&phases.includes(record.phase)}
  return {run,resume,pending,get locked(){return lockedOwner===identity()}};
}

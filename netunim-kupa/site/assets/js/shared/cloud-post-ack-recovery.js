import {commitCloudCheckpoint} from './cloud-checkpoint-publication.js';

// A new local head is not a new remote conflict. Prove its visible edits are
// journaled, merge only that delta onto the committed ACK candidate, and CAS a
// checkpoint without advancing the ACK or replacing the original operation.
// Two attempts bound immediate work under continuous typing. Unproven drafts,
// real merge conflicts and storage failures retain the caller's review fence.
export async function recoverPostAckPublication(ports,{previousState,candidateState,candidateSeq,baseState,ackRevision,ackSeq}){
  for(let attempt=0;attempt<2;attempt++){
    if(!ports.isCurrent())return null;
    const generation=ports.generation(),visible=structuredClone(ports.visible());
    const evidence=await ports.read({afterSeq:candidateSeq,previousState});
    if(!ports.isCurrent(evidence.head))return null;
    if(ports.generation()!==generation)continue;
    const head=evidence.head;
    if(head.base?.revision!==ackRevision||head.base.ackSeq!==ackSeq||head.flight||head.control||!ports.equal(head.base.state,baseState))return null;
    // Replaying the actual post-candidate journal on the pre-ACK view must
    // explain every displayed edit. A staged/non-durable draft is not proof.
    if(!ports.equal(evidence.replayedPrevious,visible))return null;
    const merged=ports.merge(previousState,visible,candidateState,evidence.deleteIntents);
    if(merged.conflicts.length)return null;
    const current=()=>ports.isCurrent()&&ports.generation()===generation&&ports.equal(ports.visible(),visible);
    if(!current())continue;
    try{
      const receipt=await commitCloudCheckpoint({
        commit:()=>ports.commit(merged.state,{expectedHead:evidence.expectedHead,isCurrent:current}),
        isCurrent:committed=>current()&&ports.isCurrent(committed)&&committed?.seq===head.seq,
        publish:()=>{ports.publish(merged.state)},
      });
      if(receipt.published)return {state:receipt.committed,generation};
      if(receipt.reason==='publication-error')throw receipt.error;
    }catch(error){
      if(!ports.isCurrent())return null;
      if(error?.message==='storage_cloud_scope_changed'&&ports.generation()!==generation)continue;
      if(error?.message!=='storage_cloud_recovery_stale')throw error;
    }
  }
  return null;
}

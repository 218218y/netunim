import {commitCloudCheckpoint} from './cloud-checkpoint-publication.js';

// A new local head is not a new remote conflict. Prove its visible edits are
// journaled, merge only that delta onto the committed ACK candidate, and CAS a
// checkpoint without advancing the ACK or replacing the original operation.
// Two immediate attempts, then (only for a moving local head) up to four quiet
// retries owned by the existing save operation. No new flight, ACK or timer
// owner is created. Unproven data and real conflicts still fail closed.
export async function recoverPostAckPublication(ports,{previousState,candidateState,candidateSeq,baseState,ackRevision,ackSeq}){
  const diagnose=(reason,attempt)=>ports.diagnose?.({reason,attempt});
  for(let attempt=0;attempt<6;attempt++){
    if(!ports.isCurrent()){diagnose('scope_lost',attempt);return null}
    if(attempt>=2){
      diagnose(attempt===2?'immediate_retry_exhausted':'quiet_retry',attempt);
      if(!ports.waitForQuiet){diagnose('bounded_retry_exhausted',attempt);return null}
      if(!await ports.waitForQuiet()){diagnose(ports.isCurrent()?'quiet_wait_incomplete':'scope_lost',attempt);return null}
      if(!ports.isCurrent()){diagnose('scope_lost',attempt);return null}
    }
    const generation=ports.generation(),visible=structuredClone(ports.visible());
    let evidence;
    try{evidence=await ports.read({afterSeq:candidateSeq,previousState})}catch(error){diagnose('journal_read_failed',attempt);throw error}
    if(!ports.isCurrent(evidence.head)){diagnose('scope_lost',attempt);return null}
    if(ports.generation()!==generation){diagnose('read_stale_generation',attempt);continue}
    const head=evidence.head;
    if(head.base?.revision!==ackRevision||head.base.ackSeq!==ackSeq||head.flight||head.control||!ports.equal(head.base.state,baseState)){diagnose('head_changed',attempt);return null}
    // Replaying the actual post-candidate journal on the pre-ACK view must
    // explain every displayed edit. A staged/non-durable draft is not proof.
    if(!ports.equal(evidence.replayedPrevious,visible)){diagnose('replay_mismatch',attempt);return null}
    const merged=ports.merge(previousState,visible,candidateState,evidence.deleteIntents);
    if(merged.conflicts.length){diagnose('merge_conflict',attempt);return null}
    const current=()=>ports.isCurrent()&&ports.generation()===generation&&ports.equal(ports.visible(),visible);
    if(!current()){diagnose('publication_stale_generation',attempt);continue}
    try{
      const receipt=await commitCloudCheckpoint({
        commit:()=>ports.commit(merged.state,{expectedHead:evidence.expectedHead,isCurrent:current}),
        isCurrent:committed=>current()&&ports.isCurrent(committed)&&committed?.seq===head.seq,
        publish:()=>{ports.publish(merged.state)},
      });
      if(receipt.published){diagnose('recovered',attempt);return {state:receipt.committed,generation}}
      if(receipt.reason==='publication-error'){diagnose('publication_exception',attempt);throw receipt.error}
      diagnose('publication_stale',attempt);
    }catch(error){
      if(!ports.isCurrent()){diagnose('scope_lost',attempt);return null}
      if(error?.message==='storage_cloud_scope_changed'&&ports.generation()!==generation){diagnose('cas_stale_generation',attempt);continue}
      if(error?.message!=='storage_cloud_recovery_stale'){diagnose('storage_error',attempt);throw error}
      diagnose('cas_stale',attempt);
    }
  }
  diagnose('bounded_retry_exhausted',6);return null;
}

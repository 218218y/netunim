// @ts-check
/** @typedef {{localGeneration?:number,localUndurableGenerations?:Set<string|number>}} MutationSession */
/** @param {MutationSession} session */
export function hasFailedLocalMutation(session){
  return [...(session.localUndurableGenerations||[])].some(token=>String(token).startsWith('failed:'));
}

// The visible model may be an optimistic draft. Only the captured receipt can
// advance it to durable; a newer edit never clears an older failed admission.
// This owns no queue or snapshot: V2 remains the sole durable state owner.
/** @param {{session:MutationSession,scope?:()=>unknown,onFailure:(error:unknown)=>void}} ports */
export function createLocalMutationAdmission({session,scope=()=>null,onFailure}){
  /** @param {string|number} token */
  function capture(token){
    const identity=scope(),risks=session.localUndurableGenerations??=new Set();
    const current=()=>identity===scope()&&risks===session.localUndurableGenerations;
    /** @param {unknown} error */
    function fail(error){risks.add(token);risks.add(`failed:${token}`);if(current())onFailure(error)}
    return {risks,current,fail};
  }
  /** @param {string|number} token @param {unknown} error */
  function reject(token,error){capture(token).fail(error);return false}
  /** @param {string|number} token
   * @param {()=>{localOk:boolean,accepted:boolean,committed:Promise<unknown>|null}} submit */
  function admit(token,submit){
    const guard=capture(token);
    const receipt={localOk:false,accepted:false,phase:'proposed',committed:Promise.resolve(false),settled:Promise.resolve(false),current:guard.current};
    try{
      const result=submit();
      if(!result.accepted||typeof result.committed?.then!=='function')throw new Error('storage_local_commit_receipt_required');
      receipt.localOk=result.localOk;receipt.accepted=true;receipt.phase='durable-pending';
      if(!result.localOk)guard.risks.add(token);
      receipt.committed=result.committed.then(confirmed=>{
        if(confirmed!==true){receipt.phase='failed';guard.fail(new Error('storage_local_commit_unconfirmed'));return false}
        guard.risks.delete(token);receipt.phase='durable';return true;
      },error=>{receipt.phase='failed';guard.fail(error);throw error});
      receipt.settled=receipt.committed.catch(()=>false);
    }catch(error){receipt.phase='rejected';guard.fail(error)}
    return receipt;
  }
  /** Retire failed drafts only after the actual journal proves the complete
   * visible business state, with no intervening generation/scope change.
   * @param {()=>Promise<boolean>} prove */
  async function reconcile(prove){
    if(!hasFailedLocalMutation(session))return true;
    const guard=capture('reconcile'),generation=session.localGeneration,failed=[...guard.risks].filter(token=>String(token).startsWith('failed:'));
    if(await prove()&&guard.current()&&generation===session.localGeneration){
      for(const token of failed){guard.risks.delete(token);const original=String(token).slice(7);for(const value of guard.risks)if(String(value)===original)guard.risks.delete(value)}
    }
    return !hasFailedLocalMutation(session);
  }
  return {admit,reject,reconcile};
}

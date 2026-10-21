// @ts-check
/** @typedef {{localUndurableGenerations?:Set<string|number>}} MutationSession */
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
    const receipt={localOk:false,accepted:false,phase:'proposed',committed:Promise.resolve(false),current:guard.current};
    try{
      const result=submit();
      if(!result.accepted||typeof result.committed?.then!=='function')throw new Error('storage_local_commit_receipt_required');
      receipt.localOk=result.localOk;receipt.accepted=true;receipt.phase='durable-pending';
      if(!result.localOk)guard.risks.add(token);
      receipt.committed=result.committed.then(confirmed=>{
        if(confirmed!==true)throw new Error('storage_local_commit_unconfirmed');
        guard.risks.delete(token);receipt.phase='durable';return true;
      }).catch(error=>{receipt.phase='failed';guard.fail(error);return false});
    }catch(error){receipt.phase='rejected';guard.fail(error)}
    return receipt;
  }
  return {admit,reject};
}

// @ts-check

// Tracks accepted work from entry, including asynchronous preflight. Closing
// rejects new work but never aborts accepted journal/file/cloud operations.
export function createRuntimeTaskOwner(){
  /** @type {Set<Promise<unknown>>} */
  const pending=new Set();
  let active=true;

  /**
   * @template T
   * @param {()=>T|PromiseLike<T>} work
   * @returns {Promise<T>}
   */
  function run(work){
    if(!active)throw new Error('runtime_task_owner_closed');
    if(typeof work!=='function')throw new TypeError('runtime_task_owner_work_required');
    // Invoke immediately: synchronous durability submission must not move to a
    // later microtask merely because its completion now has an explicit owner.
    /** @type {(value:T|PromiseLike<T>)=>void} */
    let complete=()=>{};
    /** @type {(error:unknown)=>void} */
    let fail=()=>{};
    /** @type {Promise<T>} */
    const completion=new Promise((resolve,reject)=>{complete=resolve;fail=reject});
    const tracked=completion.finally(()=>pending.delete(tracked));
    pending.add(tracked);
    try{complete(work())}catch(error){
      pending.delete(tracked);fail(error);
      // No returned promise exists when synchronous command validation throws.
      // Keep that exception synchronous and settle any already observing drain.
      void tracked.catch(()=>{});throw error;
    }
    return tracked;
  }
  async function drain(){while(pending.size)await Promise.allSettled([...pending])}
  function close(){if(!active)return false;active=false;return true}
  return {run,drain,close,isActive:()=>active,isPending:()=>pending.size>0};
}

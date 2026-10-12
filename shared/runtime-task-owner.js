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
    let result;
    try{result=work()}catch(error){result=Promise.reject(error)}
    const tracked=Promise.resolve(result).finally(()=>pending.delete(tracked));
    pending.add(tracked);
    return tracked;
  }
  async function drain(){while(pending.size)await Promise.allSettled([...pending])}
  function close(){if(!active)return false;active=false;return true}
  return {run,drain,close,isActive:()=>active,isPending:()=>pending.size>0};
}

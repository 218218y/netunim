// @ts-check

// Admission and accepted-work lifetime for document side effects. Closing does
// not abort an accepted filesystem write or its following invalidation/audit.
export function createDocumentCommandOwner() {
  let active=true;
  /** @type {Set<Promise<unknown>>} */
  const pending=new Set();
  /** @template T @param {()=>T|PromiseLike<T>} work @returns {Promise<T>} */
  function run(work) {
    if(!active)return Promise.reject(Object.assign(new Error('Document commands are stopping'),{code:'DOCUMENT_COMMANDS_DISPOSED'}));
    if(typeof work!=='function')return Promise.reject(new TypeError('document_command_work_required'));
    const task=Promise.resolve().then(work);
    const completed=task.then(()=>{},()=>{});
    pending.add(completed);
    void completed.then(()=>pending.delete(completed));
    return task;
  }
  function close(){const changed=active;active=false;return changed}
  async function drain(){while(pending.size)await Promise.all([...pending])}
  async function dispose(){close();await drain()}
  return {run,close,drain,dispose};
}

// Preserve the first observed failure while joining every accepted sibling.
/** @template T @param {readonly PromiseLike<T>[]} tasks @returns {Promise<T[]>} */
export async function joinDocumentReads(tasks) {
  let failed=false;
  /** @type {unknown} */ let firstFailure;
  const results=await Promise.allSettled(tasks.map(async task=>{
    try { return await task; }
    catch(error) { if(!failed){failed=true;firstFailure=error} throw error; }
  }));
  if(failed)throw firstFailure;
  return results.map(result=>{
    if(result.status==='rejected')throw result.reason;
    return result.value;
  });
}

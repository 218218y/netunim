// @ts-check

// A failed boot remains failed. Retrying requires a new runtime so partially
// acquired locks, listeners and jobs cannot be acquired a second time.
/**
 * @template T
 * @param {() => T | PromiseLike<T>} run
 * @returns {() => Promise<T>}
 */
export function createStartupTask(run){
  if(typeof run!=='function')throw new TypeError('startup_task_required');
  /** @type {Promise<T>|undefined} */
  let task;
  return function start(){
    if(!task)task=Promise.resolve().then(run);
    return task;
  };
}

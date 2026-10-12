/**
 * @typedef {{setTimeout:(run:()=>void,delay:number)=>number,clearTimeout:(timer:number)=>void}} DebounceTimers
 * @typedef {{run:()=>unknown,timer:number|null,ready:boolean}} PendingTask
 */

// Owns one replaceable wakeup and one started operation. Replacing/cancelling a
// wakeup never aborts work already inside a journal, file writer or cloud port.
/**
 * @param {{delay:number,onError:(error:unknown)=>void,timers?:DebounceTimers}} ports
 */
export function createDebouncedTask({delay, onError, timers=globalThis}) {
  if (!Number.isFinite(delay) || delay < 0 || typeof onError !== 'function') {
    throw new TypeError('debounced_task_ports_required');
  }
  /** @type {PendingTask|null} */
  let pending = null;
  /** @type {Promise<void>|null} */
  let current = null;
  let disposed = false;

  function cancel() {
    if (!pending) return false;
    if (pending.timer !== null) timers.clearTimeout(pending.timer);
    pending = null;
    return true;
  }

  function execute() {
    if (disposed || current || !pending?.ready) return;
    const task = pending;
    current = Promise.resolve().then(() => {
      if (disposed || pending !== task) return;
      pending = null;
      return task.run();
    }).then(() => {}, onError)
      .finally(() => { current = null; execute(); });
  }

  /** @param {()=>unknown} run */
  function schedule(run) {
    if (disposed) return false;
    if (typeof run !== 'function') throw new TypeError('debounced_task_run_required');
    cancel();
    const task = {run, timer:/** @type {number|null} */(null), ready:false};
    pending = task;
    try {
      task.timer = timers.setTimeout(() => {
        if (disposed || pending !== task) return;
        task.timer = null;
        task.ready = true;
        execute();
      }, delay);
    } catch (error) {
      pending = null;
      onError(error);
      return false;
    }
    return true;
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    cancel();
    return true;
  }

  // Call cancel/dispose first to quiesce. Drain observes started work, including
  // a queued follow-up that becomes ready while an earlier operation is running.
  async function drain() {
    while (current) await current;
  }

  return {schedule, cancel, dispose, drain, isPending:() => !!(pending || current)};
}

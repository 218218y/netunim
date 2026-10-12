// @ts-check

/**
 * One owner reserves configuration commands at acceptance, before their first
 * read. Provider sessions fail fast while any command is reserved, and retain
 * ownership through diagnostic/status publication, not just browser work.
 */
export function createBridgeOperationOwner() {
  let tail = Promise.resolve();
  let pendingConfigurations = 0;
  let providerActive = false;
  let closed = false;
  /** @type {Set<Promise<unknown>>} */
  const tasks = new Set();
  const stopping = () => Object.assign(new Error('Bank Bridge נסגר. המתן לסיום הפעולות הקיימות ופתח אותו שוב.'), {code:'BRIDGE_STOPPING'});
  const busy = () => Object.assign(
    new Error('לא ניתן לשנות הגדרות או להתחיל סנכרון נוסף בזמן שמתבצעת פעולה פיננסית'),
    {code: 'SCRAPE_BUSY'},
  );

  function assertAccepting() {
    if (closed) throw stopping();
  }
  /** @template T @param {Promise<T>} task @returns {Promise<T>} */
  function track(task) {
    tasks.add(task);
    void task.then(() => tasks.delete(task), () => tasks.delete(task));
    return task;
  }

  /** @template T @param {() => T | PromiseLike<T>} command @param {boolean} [mutating=false] @returns {Promise<T>} */
  function enqueue(command, mutating = false) {
    if (mutating) pendingConfigurations++;
    const task = tail.then(command).finally(() => { if (mutating) pendingConfigurations--; });
    // A rejected command releases ownership without poisoning later commands.
    tail = task.then(() => {}, () => {});
    return track(task);
  }

  /** @template T @param {() => T | PromiseLike<T>} command @returns {Promise<T>} */
  function configuration(command) {
    if (closed) return Promise.reject(stopping());
    if (providerActive) return Promise.reject(busy());
    return enqueue(command, true);
  }

  // Status may be queried during a provider session, but cannot read the vault
  // halfway through an accepted configuration write or replacement.
  /** @template T @param {() => T | PromiseLike<T>} command @returns {Promise<T>} */
  function read(command) {
    return closed ? Promise.reject(stopping()) : enqueue(command);
  }

  /** @template T @param {() => T | PromiseLike<T>} command @returns {Promise<T>} */
  function provider(command) {
    if (closed) return Promise.reject(stopping());
    if (providerActive || pendingConfigurations) return Promise.reject(busy());
    providerActive = true;
    return track(Promise.resolve().then(command).finally(() => { providerActive = false; }));
  }

  function close() {
    if (closed) return false;
    closed = true;
    return true;
  }

  async function drain() {
    while (tasks.size) await Promise.allSettled([...tasks]);
  }

  return Object.freeze({configuration, provider, read, assertAccepting, close, drain});
}

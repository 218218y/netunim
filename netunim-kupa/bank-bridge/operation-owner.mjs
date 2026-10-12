// @ts-check

/**
 * One owner reserves configuration commands at acceptance, before their first
 * read. Provider sessions fail fast while any command is reserved, and retain
 * ownership through diagnostic/status publication, not just browser work.
 */
export function createBridgeOperationOwner() {
  let tail = Promise.resolve();
  let pending = 0;
  let providerActive = false;
  const busy = () => Object.assign(
    new Error('לא ניתן לשנות הגדרות או להתחיל סנכרון נוסף בזמן שמתבצעת פעולה פיננסית'),
    {code: 'SCRAPE_BUSY'},
  );

  /** @template T @param {() => T | PromiseLike<T>} command @returns {Promise<T>} */
  function enqueue(command) {
    pending++;
    const task = tail.then(command).finally(() => { pending--; });
    // A rejected command releases ownership without poisoning later commands.
    tail = task.then(() => {}, () => {});
    return task;
  }

  /** @template T @param {() => T | PromiseLike<T>} command @returns {Promise<T>} */
  function configuration(command) {
    if (providerActive) return Promise.reject(busy());
    return enqueue(command);
  }

  // Status may be queried during a provider session, but cannot read the vault
  // halfway through an accepted configuration write or replacement.
  /** @template T @param {() => T | PromiseLike<T>} command @returns {Promise<T>} */
  function read(command) { return enqueue(command); }

  /** @template T @param {() => T | PromiseLike<T>} command @returns {Promise<T>} */
  async function provider(command) {
    if (providerActive || pending) throw busy();
    providerActive = true;
    try { return await command(); }
    finally { providerActive = false; }
  }

  return Object.freeze({configuration, provider, read});
}

// @ts-check

/** @typedef {{pid: number, token: string | null, startedAt: string | null}} FileLockOwner
 * @typedef {{kind: 'absent'} | {kind: 'unknown'} | {kind: 'owner', owner: FileLockOwner}} FileLockState
 * @typedef {{create: (path: string) => Promise<boolean>, observe: (path: string) => Promise<FileLockState>,
 * writeOwner: (path: string, owner: FileLockOwner) => Promise<void>,
 * removeOwner: (path: string) => Promise<boolean>, removeDirectory: (path: string) => Promise<boolean>}} FileLockFiles
 * @typedef {{files: FileLockFiles, owners: {next: () => FileLockOwner, alive: (pid: number) => Promise<boolean>},
 * clock: () => number, wait: (ms: number) => Promise<void>}} FileLockPorts
 */
/** @param {string} code @param {string} message */
const failure = (code, message) => Object.assign(new Error(message), {code});
const changed = () => failure('FILE_LOCK_SCOPE_CHANGED', 'File lock ownership changed; no foreign lock was removed');
const uncertain = () => failure('FILE_LOCK_OWNER_UNCERTAIN', 'לא ניתן לאמת את בעל הנעילה של אינדקס PDF. יש לבדוק את השירות לפני עדכון נוסף.');
/** @param {FileLockOwner} a @param {FileLockOwner} b */
const sameOwner = (a, b) => a.pid === b.pid && a.token === b.token && a.startedAt === b.startedAt;

/** @param {FileLockPorts} ports */
export function createFileLockOwner({files, owners, clock, wait}) {
  if ([files?.create, files?.observe, files?.writeOwner, files?.removeOwner, files?.removeDirectory,
    owners?.next, owners?.alive, clock, wait].some(port => typeof port !== 'function')) throw new Error('file_lock_ports_required');
  function nextOwner() {
    const owner = owners.next();
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || typeof owner.token !== 'string' || !owner.token ||
        typeof owner.startedAt !== 'string' || !owner.startedAt) throw new Error('file_lock_owner_required');
    return owner;
  }
  /** @param {string} path @param {FileLockOwner} owner */
  async function assertOwner(path, owner) {
    const state = await files.observe(path);
    if (state.kind !== 'owner' || !sameOwner(state.owner, owner)) throw changed();
  }
  /** @param {string} path @param {FileLockOwner} owner */
  async function initialize(path, owner) {
    try { await files.writeOwner(path, owner); } catch (error) {
      // Empty bootstrap reservations can be removed. A partial owner file stays
      // retained and blocks takeover; initialization failure never starts work.
      try { await files.removeDirectory(path); } catch (cleanup) {
        throw Object.assign(new AggregateError([error, cleanup], 'File lock initialization cleanup failed'), {code: 'FILE_LOCK_INITIALIZATION_FAILED'});
      }
      throw error;
    }
  }
  /** @param {string} path @param {FileLockOwner} owner */
  async function release(path, owner) {
    await assertOwner(path, owner);
    if (!await files.removeOwner(path) || !await files.removeDirectory(path)) throw changed();
  }
  /** @template T @param {string} path @param {FileLockOwner} owner @param {() => Promise<T>} task @returns {Promise<T>} */
  async function execute(path, owner, task) {
    /** @type {{ok: true, value: T} | {ok: false, error: unknown}} */
    let outcome;
    try { await assertOwner(path, owner); outcome = {ok: true, value: await task()}; }
    catch (error) { outcome = {ok: false, error}; }
    try { await release(path, owner); } catch (cleanup) {
      throw Object.assign(new AggregateError(outcome.ok ? [cleanup] : [outcome.error, cleanup], 'File lock release failed; inspect the retained lock'), {code: 'FILE_LOCK_RELEASE_FAILED'});
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }
  /** @param {string} path */
  async function reclaim(path) {
    // Serialize reapers separately. Every winner observes the canonical owner
    // afresh; a stale waiter must not unlink a replacement's metadata. Unknown
    // or orphaned reaper gates require explicit review, not recursive expiry.
    const gate = `${path}.reclaim`;
    const owner = nextOwner();
    if (!await files.create(gate)) return false;
    await initialize(gate, owner);
    return execute(gate, owner, async () => {
      const state = await files.observe(path);
      if (state.kind === 'absent') return true;
      if (state.kind !== 'owner' || await owners.alive(state.owner.pid)) return false;
      if (!await files.removeOwner(path) || !await files.removeDirectory(path)) throw changed();
      return true;
    });
  }
  /** @template T @param {string} path @param {() => Promise<T>} task
   * @param {{waitMs?: number}} [options] @returns {Promise<T>} */
  async function run(path, task, {waitMs = 10000} = {}) {
    if (!Number.isFinite(waitMs) || waitMs < 0 || typeof task !== 'function') throw new Error('file_lock_request_required');
    const deadline = clock() + waitMs, owner = nextOwner(); let reclaims = 0;
    while (true) {
      if (await files.create(path)) { await initialize(path, owner); return execute(path, owner, task); }
      const state = await files.observe(path);
      const held = state.kind === 'owner' && await owners.alive(state.owner.pid);
      if (state.kind === 'owner' && !held && reclaims < 32) {
        if (await reclaim(path)) { reclaims++; continue; }
      }
      const remaining = deadline - clock();
      if (remaining <= 0) {
        const latest = await files.observe(path);
        if (latest.kind === 'unknown') throw uncertain();
        if (latest.kind === 'owner' && await owners.alive(latest.owner.pid)) throw failure('FILE_LOCK_TIMEOUT', 'Timed out waiting for file lock');
        throw failure('FILE_LOCK_RECLAIM_BLOCKED', 'לא ניתן לאמת שחזור בטוח של נעילת אינדקס PDF. יש לבדוק את השירות לפני עדכון נוסף.');
      }
      await wait(Math.min(80, remaining));
    }
  }
  /** @param {string} path */
  async function isHeld(path) {
    const state = await files.observe(path);
    if (state.kind === 'absent') return false;
    if (state.kind === 'unknown') throw uncertain();
    return owners.alive(state.owner.pid);
  }
  return {run, isHeld};
}

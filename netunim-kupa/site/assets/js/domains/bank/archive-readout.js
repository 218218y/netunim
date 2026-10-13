// @ts-check
import { readBankArchiveBatch } from '../../shared/bank-archive-read-batch.js';

/** @typedef {import('../../shared/bank-archive-read-batch.js').ArchiveRole} ArchiveRole */
/** @typedef {import('../../shared/bank-archive-read-batch.js').ArchiveGuard} ArchiveGuard */
/** @typedef {import('../../shared/bank-archive-read-batch.js').ArchiveTarget} ArchiveTarget */
/** @template Row @typedef {{accountKey:string,syncKey:string,rows:readonly Row[]|null,directSnapshot:unknown,assertCurrent?:ArchiveGuard}} ArchiveCache */
/** @template Row @typedef {{accountKey:string,syncKey:string,rows:readonly Row[],directSnapshot:unknown,assertCurrent:ArchiveGuard}} ArchivePublication */
/** @template Row @typedef {Partial<Record<ArchiveRole,ArchivePublication<Row>>>} ArchiveCandidate */
/** @typedef {{signature:string,assertCurrent:ArchiveGuard,promise:Promise<boolean>|null}} ArchiveFlight */

/** @param {unknown} error */
function scopeChanged(error) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'FINANCE_OPERATION_SCOPE_CHANGED'
  );
}

/**
 * Private Kupa projection owner; cloud hydration never replaces local-save policy.
 * @template {{archiveId?:unknown}} Row
 * @param {{
 * authority:{captureRead:()=>ArchiveGuard},
 * sources:{targets:()=>readonly ArchiveTarget[]},
 * reads:import('../../shared/bank-archive-read-batch.js').ArchiveReads<Row>,
 * access:{cloud:()=>boolean},publication:()=>void,
 * report:(role:ArchiveRole,error:unknown)=>void
 * }} ports
 */
export function createKupaBankArchiveReadout({
  authority,
  sources,
  reads,
  access,
  publication,
  report,
}) {
  /** @type {[string,unknown,string[]][]} */ const required = [
    ['authority', authority, ['captureRead']],
    ['sources', sources, ['targets']],
    ['reads', reads, ['transactions', 'snapshot']],
    ['access', access, ['cloud']],
  ];
  for (const [name, port, methods] of required)
    for (const method of methods)
      if (typeof (/** @type {Record<string,unknown>} */ (port)?.[method]) !== 'function')
        throw new TypeError('kupa_bank_archive_' + name + '_' + method + '_required');
  if (typeof publication !== 'function' || typeof report !== 'function')
    throw new TypeError('kupa_bank_archive_publication_report_required');
  /** @type {ArchiveRole[]} */ const roles = ['business', 'home'];
  /** @returns {ArchiveCache<Row>} */ const empty = () => ({
    accountKey: '',
    syncKey: '',
    rows: null,
    directSnapshot: null,
  });
  /** @type {Record<ArchiveRole,ArchiveCache<Row>>} */ const cache = {
    business: empty(),
    home: empty(),
  };
  /** @type {ArchiveFlight|null} */ let flight = null;
  let disposed = false,
    paused = false;
  /** @type {Set<Promise<unknown>>} */ const owned = new Set();
  /** @template T @param {Promise<T>} promise @returns {Promise<T>} */
  function track(promise) {
    owned.add(promise);
    void promise.then(
      () => owned.delete(promise),
      () => owned.delete(promise)
    );
    return promise;
  }
  /** @returns {undefined} */
  function active() {
    if (disposed)
      throw Object.assign(Error('kupa_bank_archive_disposed'), {
        code: 'FINANCE_OPERATION_SCOPE_CHANGED',
      });
  }
  /** @param {ArchiveGuard|null|undefined} guard */
  function current(guard) {
    if (disposed || !guard) return false;
    try {
      guard();
      return true;
    } catch (error) {
      if (!scopeChanged(error)) throw error;
      return false;
    }
  }
  /** @param {ArchiveRole} role @param {string} accountKey @param {string|null|undefined} syncKey */
  function matching(role, accountKey, syncKey) {
    const slot = cache[role];
    if (
      !current(slot.assertCurrent) ||
      slot.accountKey !== String(accountKey || '') ||
      slot.syncKey !== String(syncKey || '') ||
      !Array.isArray(slot.rows)
    )
      return null;
    return { rows: /** @type {readonly Row[]} */ (slot.rows), directSnapshot: slot.directSnapshot };
  }
  /** @param {readonly ArchiveTarget[]} targets @param {{days?:number|null,assertCurrent?:ArchiveGuard}} [options] */
  function readSnapshot(targets, { days = null, assertCurrent = authority.captureRead() } = {}) {
    active();
    assertCurrent();
    return track(
      readBankArchiveBatch({ targets, days, assertCurrent, assertActive: active, reads })
    );
  }
  async function ensure() {
    if (disposed || paused || !access.cloud()) return false;
    let assertCurrent;
    try {
      assertCurrent = authority.captureRead();
    } catch (error) {
      if (scopeChanged(error)) return false;
      throw error;
    }
    const targets = sources.targets(),
      signature = JSON.stringify(
        targets.map((target) => [target.role, target.accountKey, target.syncKey])
      );
    if (flight?.signature === signature && current(flight.assertCurrent))
      return flight.promise ?? false;
    const pending = targets.filter(
      (target) => !matching(target.role, target.accountKey, target.syncKey)
    );
    if (!pending.length) return false;
    /** @type {ArchiveFlight} */ const task = { signature, assertCurrent, promise: null };
    flight = task;
    task.promise = track(
      (async () => {
        let changed = false;
        for (const target of pending) {
          if (disposed || paused || flight !== task) return false;
          try {
            assertCurrent();
            const records = await readSnapshot([target], { days: null, assertCurrent });
            assertCurrent();
            const live = sources.targets().find((item) => item.role === target.role),
              record = records[0];
            if (
              disposed ||
              flight !== task ||
              !record ||
              !live ||
              live.accountKey !== target.accountKey ||
              String(live.syncKey || '') !== String(target.syncKey || '')
            )
              continue;
            cache[target.role] = {
              accountKey: target.accountKey,
              syncKey: String(target.syncKey || ''),
              rows: record.rows,
              directSnapshot: record.directSnapshot,
              assertCurrent,
            };
            changed = true;
          } catch (error) {
            if (disposed || flight !== task) return false;
            try {
              assertCurrent();
            } catch (ownerError) {
              if (scopeChanged(ownerError)) return false;
              throw ownerError;
            }
            if (scopeChanged(error)) return false;
            report(target.role, error);
          }
        }
        assertCurrent();
        if (changed && !disposed && flight === task) publication();
        return changed;
      })()
    );
    try {
      return await task.promise;
    } finally {
      if (flight === task) flight = null;
    }
  }
  /** @param {ArchiveCandidate<Row>|null} candidate */
  function publish(candidate) {
    if (disposed || !candidate) return false;
    for (const role of roles) if (candidate[role]) candidate[role].assertCurrent();
    flight = null;
    Object.assign(cache, candidate);
    return true;
  }
  /** @param {number} transactionId */
  function invalidate(transactionId) {
    if (disposed) return false;
    const id = Number(transactionId);
    let changed = false;
    for (const role of roles) {
      const slot = cache[role];
      if (Array.isArray(slot.rows) && slot.rows.some((row) => Number(row?.archiveId) === id)) {
        slot.rows = null;
        slot.directSnapshot = null;
        changed = true;
      }
    }
    return changed;
  }
  function pause() {
    if (disposed || paused) return false;
    paused = true;
    flight = null;
    return true;
  }
  function resume() {
    if (disposed || !paused) return false;
    paused = false;
    return true;
  }
  function dispose() {
    if (disposed) return false;
    disposed = true;
    paused = true;
    flight = null;
    for (const role of roles) cache[role] = empty();
    return true;
  }
  async function drain() {
    while (owned.size) await Promise.allSettled([...owned]);
  }
  return Object.freeze({
    queries: Object.freeze({ matching, readSnapshot }),
    commands: Object.freeze({ publish, invalidate }),
    runtime: Object.freeze({ ensure, pause, resume, dispose, drain }),
  });
}

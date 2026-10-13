// @ts-check

/** @typedef {'business'|'home'} ArchiveRole */
/** @typedef {() => undefined} ArchiveGuard */
/** @typedef {{role:ArchiveRole,accountKey:string,syncKey?:string}} ArchiveTarget */
/** @template Row @typedef {{role:ArchiveRole,accountKey:string,rows:readonly Row[],directSnapshot:unknown}} ArchiveRead */
/** @template Row @typedef {{accountKey:string,syncKey:string,rows:readonly Row[],directSnapshot:unknown,assertCurrent:ArchiveGuard}} ArchivePublication */
/** @template Row @typedef {Partial<Record<ArchiveRole,ArchivePublication<Row>>>} ArchiveCandidate */
/** @template Row @typedef {{accountKey:string,syncKey:string,rows:readonly Row[]|null,directSnapshot:unknown,assertCurrent?:ArchiveGuard}} ArchiveCache */
/** @typedef {{days:number|null,assertCurrent:ArchiveGuard}} ArchiveReadOptions */
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
 * Inert read owner. All accepted requests, including superseded reads and the
 * surviving sibling of a failed read, remain owned until they settle.
 * @template {{archiveId?:unknown}} Row
 * @param {{
 * authority:{captureRead:()=>ArchiveGuard},
 * sources:{targets:()=>readonly ArchiveTarget[],rows:()=>readonly (readonly Row[])[]},
 * reads:{transactions:(accountKey:string,role:ArchiveRole,options:ArchiveReadOptions)=>Promise<readonly Row[]>,snapshot:(accountKey:string,role:ArchiveRole,options:{assertCurrent:ArchiveGuard})=>Promise<unknown>},
 * access:{authenticated:()=>boolean,online:()=>boolean},
 * revision:{read?:()=>string|number|null|undefined,touch:()=>number|undefined},
 * report:(role:ArchiveRole,error:unknown)=>void
 * }} ports
 */
export function createOrdersBankArchiveReadout({
  authority,
  sources,
  reads,
  access,
  revision,
  report,
}) {
  /** @type {[string,unknown,string[]][]} */ const required = [
    ['authority', authority, ['captureRead']],
    ['sources', sources, ['targets', 'rows']],
    ['reads', reads, ['transactions', 'snapshot']],
    ['access', access, ['authenticated', 'online']],
    ['revision', revision, ['touch']],
  ];
  for (const [name, port, methods] of required)
    for (const method of methods)
      if (typeof (/** @type {Record<string,unknown>} */ (port)?.[method]) !== 'function')
        throw new TypeError('orders_bank_archive_' + name + '_' + method + '_required');
  if (typeof report !== 'function') throw new TypeError('orders_bank_archive_report_required');
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
  /** @type {ArchiveGuard|null} */ let projectionScope = null;
  let disposed = false,
    paused = false,
    projectionUnavailable = false,
    epoch = 0;
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
  function active() {
    if (disposed)
      throw Object.assign(new Error('orders_bank_archive_disposed'), {
        code: 'FINANCE_OPERATION_SCOPE_CHANGED',
      });
  }
  /** @param {ArchiveGuard|null|undefined} guard */
  function scopeIsCurrent(guard) {
    if (disposed || !guard) return false;
    try {
      guard();
      return true;
    } catch (error) {
      if (!scopeChanged(error)) throw error;
      return false;
    }
  }
  function projectionRevision() {
    if (!disposed && !scopeIsCurrent(projectionScope)) {
      try {
        projectionScope = authority.captureRead();
        projectionUnavailable = false;
        epoch++;
      } catch (error) {
        if (!scopeChanged(error)) throw error;
        projectionScope = null;
        if (!projectionUnavailable) epoch++;
        projectionUnavailable = true;
      }
    }
    const value = revision.read?.();
    return value === undefined || value === null ? value : `${value}:${epoch}`;
  }
  /** @param {ArchiveRole} role @param {string} accountKey @param {string|null|undefined} syncKey */
  function matching(role, accountKey, syncKey) {
    const slot = cache[role];
    if (
      !accountKey ||
      !scopeIsCurrent(slot.assertCurrent) ||
      slot.accountKey !== String(accountKey || '') ||
      slot.syncKey !== String(syncKey || '') ||
      !Array.isArray(slot.rows)
    )
      return null;
    return { rows: /** @type {readonly Row[]} */ (slot.rows), directSnapshot: slot.directSnapshot };
  }
  function ready() {
    return (
      !disposed &&
      sources
        .targets()
        .every((target) => !!matching(target.role, target.accountKey, target.syncKey))
    );
  }
  function touch() {
    revision.touch();
    epoch++;
  }

  /**
   * Invoke in the existing rows/snapshot order. A synchronous failure stops
   * further starts, but every already accepted promise is still joined.
   * The first failure is retained unless live authority has since changed.
   * @param {readonly ArchiveTarget[]} targets
   * @param {{days?:number|null,assertCurrent?:ArchiveGuard}} [options]
   * @returns {Promise<ArchiveRead<Row>[]>}
   */
  function readSnapshot(targets, { days = null, assertCurrent = authority.captureRead() } = {}) {
    active();
    assertCurrent();
    return track(
      (async () => {
        /** @type {Promise<unknown>[]} */ const accepted = [];
        /** @type {{target:ArchiveTarget,rows:Promise<readonly Row[]>,snapshot:Promise<unknown>}[]} */ const pairs =
          [];
        let failed = false;
        /** @type {unknown} */ let firstFailure;
        /** @param {unknown} error @returns {never} */
        function reject(error) {
          if (!failed) {
            failed = true;
            firstFailure = error;
          }
          throw error;
        }
        try {
          for (const target of targets) {
            assertCurrent();
            const rows = Promise.resolve(
              reads.transactions(target.accountKey, target.role, { days, assertCurrent })
            ).catch(reject);
            accepted.push(rows);
            const snapshot = Promise.resolve(
              reads.snapshot(target.accountKey, target.role, { assertCurrent })
            ).catch(reject);
            accepted.push(snapshot);
            pairs.push({ target, rows, snapshot });
          }
        } catch (error) {
          if (!failed) {
            failed = true;
            firstFailure = error;
          }
        }
        await Promise.allSettled(accepted);
        active();
        assertCurrent();
        if (failed) throw firstFailure;
        /** @type {ArchiveRead<Row>[]} */ const result = [];
        for (const pair of pairs)
          result.push({
            role: pair.target.role,
            accountKey: pair.target.accountKey,
            rows: await pair.rows,
            directSnapshot: await pair.snapshot,
          });
        active();
        assertCurrent();
        return result;
      })()
    );
  }

  /** @returns {Promise<boolean>} */
  async function ensure() {
    if (disposed || paused || !access.authenticated() || !access.online()) return false;
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
    if (flight?.signature === signature && scopeIsCurrent(flight.assertCurrent))
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
            const current = sources.targets().find((item) => item.role === target.role),
              record = records[0];
            if (
              disposed ||
              flight !== task ||
              !record ||
              !current ||
              current.accountKey !== target.accountKey ||
              String(current.syncKey || '') !== String(target.syncKey || '')
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
        if (changed && !disposed && flight === task) touch();
        return changed;
      })()
    );
    try {
      return await task.promise;
    } finally {
      if (flight === task) flight = null;
    }
  }
  /** @param {ArchiveCandidate<Row>} candidate @returns {boolean} */
  function publish(candidate) {
    if (disposed) return false;
    for (const role of roles) if (candidate[role]) candidate[role].assertCurrent();
    flight = null;
    Object.assign(cache, candidate);
    touch();
    return true;
  }
  /** @param {number} transactionId @param {(row:Row)=>undefined} mutator @returns {boolean} */
  function update(transactionId, mutator) {
    if (disposed) return false;
    const id = Number(transactionId);
    let changed = false;
    /** @param {readonly Row[]|null} rows */
    const apply = (rows) => {
      if (!Array.isArray(rows)) return;
      for (const row of rows)
        if (Number(row?.archiveId) === id) {
          mutator(row);
          changed = true;
        }
    };
    for (const role of roles) apply(cache[role].rows);
    for (const rows of sources.rows()) apply(rows);
    if (changed) touch();
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
    projectionScope = null;
    epoch++;
    for (const role of roles) cache[role] = empty();
    return true;
  }
  async function drain() {
    while (owned.size) await Promise.allSettled([...owned]);
  }
  return Object.freeze({
    queries: Object.freeze({ matching, ready, revision: projectionRevision, readSnapshot }),
    commands: Object.freeze({ publish, update }),
    runtime: Object.freeze({ ensure, pause, resume, dispose, drain }),
  });
}

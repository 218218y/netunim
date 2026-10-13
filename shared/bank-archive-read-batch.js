// @ts-check

/** @typedef {'business'|'home'} ArchiveRole */
/** @typedef {() => undefined} ArchiveGuard */
/** @typedef {{role:ArchiveRole,accountKey:string,syncKey?:string}} ArchiveTarget */
/** @template Row @typedef {{role:ArchiveRole,accountKey:string,rows:readonly Row[],directSnapshot:unknown}} ArchiveRead */
/** @typedef {{days:number|null,assertCurrent:ArchiveGuard}} ArchiveReadOptions */
/** @template Row @typedef {{transactions:(accountKey:string,role:ArchiveRole,options:ArchiveReadOptions)=>Promise<readonly Row[]>,snapshot:(accountKey:string,role:ArchiveRole,options:{assertCurrent:ArchiveGuard})=>Promise<unknown>}} ArchiveReads */

/**
 * A caller owns the returned promise until every accepted request settles.
 * Preserve rows/snapshot start order and the first failure, unless live
 * authority changed. Synchronous failures stop further starts.
 * @template Row
 * @param {{targets:readonly ArchiveTarget[],days:number|null,assertCurrent:ArchiveGuard,assertActive:ArchiveGuard,reads:ArchiveReads<Row>}} ports
 * @returns {Promise<ArchiveRead<Row>[]>}
 */
export async function readBankArchiveBatch({ targets, days, assertCurrent, assertActive, reads }) {
  assertActive();
  assertCurrent();
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
      assertActive();
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
  assertActive();
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
  assertActive();
  assertCurrent();
  return result;
}

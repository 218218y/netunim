// @ts-check
import {bankTransactionStatus} from './bank-transaction-evidence.js';

/** @typedef {Record<string,unknown>} ArchiveRow */
/** @typedef {{sourcePayload:ArchiveRow[],result:Record<string,unknown>|null}} ArchiveMerge */
/** @typedef {{complete:boolean,from:string|null,to:string|null,days:number|null,warning:string}} TransactionCoverage */
/** @typedef {{sourceCount:number,archiveCount:number,insertedCount:number,updatedCount:number,verifiedAt:string,exactCount:boolean}} ArchiveCoverageAudit */

/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {Record<string,unknown>|null|undefined} snapshot */
function accountIdOf(snapshot) {
  return (
    snapshot?.accountId ||
    [snapshot?.branchNumber, snapshot?.accountNumber].filter(Boolean).join('-') ||
    snapshot?.accountNumber ||
    ''
  );
}

/** @param {Record<string,unknown>|null|undefined} snapshot @returns {TransactionCoverage} */
function completeTransactionCoverage(snapshot) {
  const coverage =
      snapshot?.transactionCoverage && typeof snapshot.transactionCoverage === 'object'
        ? /** @type {Record<string,unknown>} */ (snapshot.transactionCoverage)
        : {},
    from = String(coverage.from || ''),
    to = String(coverage.to || ''),
    valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to,
    warning = String(snapshot?.transactionWarning || '');
  return {
    complete: coverage.complete === true && !warning && valid,
    from: valid ? from : null,
    to: valid ? to : null,
    days: Number(coverage.days) || null,
    warning,
  };
}

/** @param {unknown} value @returns {string|undefined} */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(/** @type {Record<string,unknown>} */ (value)[key])}`
      )
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** @param {unknown} a @param {unknown} b */
function sameInstant(a, b) {
  if (!a && !b) return true;
  const x = Date.parse(/** @type {string} */ (a || '')),
    y = Date.parse(/** @type {string} */ (b || ''));
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

/** @param {unknown} a @param {unknown} b */
function sameNumber(a, b) {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
  return Number(a) === Number(b);
}

/** @param {ArchiveMerge} mergeResult @param {readonly ArchiveRow[]} archive @param {{role?:string,requireExactCount?:boolean}} options @returns {ArchiveCoverageAudit} */
function assertBankArchiveCoverage(mergeResult, archive, { role, requireExactCount = false } = {}) {
  const source = Array.isArray(mergeResult?.sourcePayload) ? mergeResult.sourcePayload : [],
    rows = Array.isArray(archive) ? archive : [],
    byKey = new Map();
  for (const row of rows) {
    const key = String(row?.id || '');
    if (!key || byKey.has(key))
      throw new Error(`אימות ארכיון הבנק נכשל (${role || 'חשבון'}): מזהה ארכיון כפול או חסר`);
    byKey.set(key, row);
  }
  for (const tx of source) {
    const row = byKey.get(String(tx.mergeKey || '')),
      statusOk =
        bankTransactionStatus(tx.status) && bankTransactionStatus(row?.status) && (tx.status === 'pending'
          ? row?.status === 'pending' || row?.status === 'completed'
          : row?.status === 'completed');
    const coreOk =
      !!row &&
      sameInstant(tx.date, row.date) &&
      sameInstant(tx.processedDate, row.processedDate) &&
      sameNumber(tx.amount, row.amount) &&
      String(tx.currency || 'ILS') === String(row.currency || 'ILS') &&
      String(tx.description || '') === String(row.description || '') &&
      String(tx.memo || '') === String(row.memo || '') &&
      String(tx.partyName || '') === String(row.partyName || '') &&
      String(tx.partyHeadline || '') === String(row.partyHeadline || '') &&
      String(tx.messageHeadline || '') === String(row.messageHeadline || '') &&
      String(tx.messageDetail || '') === String(row.messageDetail || '') &&
      sameNumber(tx.balanceAfter, row.balanceAfter) &&
      String(tx.bankReference || '') === String(row.bankReference || '') &&
      String(tx.bankSerial || '') === String(row.bankSerial || '') &&
      sameNumber(tx.activityTypeCode, row.activityTypeCode) &&
      statusOk;
    const detailsOk =
      !!row &&
      canonicalJson(tx.checkDetails ?? null) === canonicalJson(row.checkDetails ?? null) &&
      canonicalJson(tx.creditSettlementDetails ?? null) ===
        canonicalJson(row.creditSettlementDetails ?? null) &&
      Boolean(tx.cheque) === Boolean(row.cheque);
    if (!coreOk || !detailsOk)
      throw new Error(
        `אימות ארכיון הבנק נכשל (${role || 'חשבון'}): תנועת מקור לא נקראה חזרה בשלמותה (${tx.mergeKey || 'ללא מזהה'})`
      );
  }
  const total = Number(mergeResult?.result?.total_count);
  if (requireExactCount && (!Number.isSafeInteger(total) || total !== source.length))
    throw new Error(
      `אימות backfill נכשל (${role || 'חשבון'}): הבנק החזיר ${source.length} תנועות אך הארכיון מכיל ${Number.isFinite(total) ? total : 'מספר לא תקין'}`
    );
  return {
    sourceCount: source.length,
    archiveCount: Number.isSafeInteger(total) ? total : rows.length,
    insertedCount: Number(mergeResult?.result?.inserted_count) || 0,
    updatedCount: Number(mergeResult?.result?.updated_count) || 0,
    verifiedAt: new Date().toISOString(),
    exactCount: !!requireExactCount,
  };
}

export {
  accountIdOf as bankArchiveAccountId,
  completeTransactionCoverage as bankTransactionCoverage,
};

/**
 * The canonical Orders source/readback algorithm is also Kupa's existing
 * algorithm. Decode its opaque adapter inputs before granting archive evidence;
 * metadata remains advisory in incremental mode, as in the established policy.
 * @param {unknown} merge @param {unknown} rows
 * @param {{role?:string,requireExactCount?:boolean}} [options]
 * @returns {ArchiveCoverageAudit}
 */
export function verifyBankArchiveCoverage(merge, rows, options = {}) {
  if (!record(merge) || !Array.isArray(merge.sourcePayload) || !merge.sourcePayload.every(record))
    throw new TypeError('bank_archive_source_payload_required');
  if (!Array.isArray(rows) || !rows.every(record))
    throw new TypeError('bank_archive_rows_required');
  return assertBankArchiveCoverage(
    { sourcePayload: merge.sourcePayload, result: record(merge.result) ? merge.result : null },
    rows,
    options
  );
}

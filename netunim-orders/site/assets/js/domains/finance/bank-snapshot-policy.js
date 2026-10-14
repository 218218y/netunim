import { bankSnapshotFinancials } from '../../shared/bank-balance-result.js';
import { bankRecurringDebitHistoryData } from '../../shared/bank-recurring-debits.js';
import { clone, uid } from '../../core/values.js';
import { checkTodayISO } from '../../core/dates.js';
import { kupaWholeMoney } from '../../core/money.js';
import { normalizeSharedBankEvents } from '../checks/model.js';
import { normalizeBankFeed } from './bank-feed.js';

function accountIdOf(snapshot) {
  return (
    snapshot?.accountId ||
    [snapshot?.branchNumber, snapshot?.accountNumber].filter(Boolean).join('-') ||
    snapshot?.accountNumber ||
    ''
  );
}

function completeTransactionCoverage(snapshot) {
  const coverage =
      snapshot?.transactionCoverage && typeof snapshot.transactionCoverage === 'object'
        ? snapshot.transactionCoverage
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

function bankFeedFromSnapshot(snapshot, fetchedAt) {
  if (!snapshot || !Number.isFinite(Number(snapshot.balance))) return null;
  return normalizeBankFeed({
    provider: 'hapoalim',
    accountNumber: accountIdOf(snapshot),
    balance: Number(snapshot.balance),
    availableBalance: snapshot.availableBalance,
    creditLimit: snapshot.creditLimit,
    creditLimitUsed: snapshot.creditLimitUsed,
    creditLimitUsedPercent: snapshot.creditLimitUsedPercent,
    syncedAt: fetchedAt,
    transactions: snapshot.transactions || [],
    transactionWarning: snapshot.transactionWarning || '',
  });
}

function financeBankPayload(bank) {
  const out = { ...bank };
  delete out.adjustments;
  delete out.snapshotToken;
  delete out.snapshotSeq;
  return out;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

function sameInstant(a, b) {
  if (!a && !b) return true;
  const x = Date.parse(a || ''),
    y = Date.parse(b || '');
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

function sameNumber(a, b) {
  if (a === null || a === undefined || a === '') return b === null || b === undefined || b === '';
  return Number(a) === Number(b);
}

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
        String(tx.status || 'completed') === 'pending'
          ? row?.status === 'pending' || row?.status === 'completed'
          : row?.status === 'completed';
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

function observedChecksSequence(kupa, bankEvents) {
  const floor = Number(kupa?.bank?.snapshotSeq),
    start = Number.isSafeInteger(floor) && floor >= 0 ? floor : 0;
  return normalizeSharedBankEvents(bankEvents).reduce(
    (max, event) => Math.max(max, event.seq),
    start
  );
}

function buildSnapshot({
  business,
  businessAccount,
  home,
  homeFailure,
  fetchedAt,
  businessArchive,
  homeArchive,
  financeRow,
  historyDays,
  archiveReady,
  archiveVersion,
  archiveAudit,
  businessCoverage,
  homeCoverage,
  checksState,
}) {
  const businessFeed = bankFeedFromSnapshot(
      { ...business, transactions: businessArchive },
      fetchedAt
    ),
    homeFeed = home
      ? bankFeedFromSnapshot({ ...home, transactions: homeArchive }, fetchedAt)
      : null,
    kupa = checksState.kupa || {},
    snapshotToken = uid('BANK'),
    snapshotSeq = observedChecksSequence(kupa, checksState.bankEvents);
  const financeBase =
      financeRow?.state && typeof financeRow.state === 'object' ? clone(financeRow.state) : {},
    previousBank = financeBase.bank && typeof financeBase.bank === 'object' ? financeBase.bank : {},
    nextHomeFeed = home ? homeFeed : homeFailure ? (previousBank.homeFeed ?? null) : null;
  businessFeed.recurringDebitHistory = bankRecurringDebitHistoryData(
    previousBank.feed,
    businessFeed,
    'business',
    businessCoverage
  );
  if (homeFeed)
    homeFeed.recurringDebitHistory = bankRecurringDebitHistoryData(
      previousBank.homeFeed,
      homeFeed,
      'home',
      homeCoverage
    );
  const exactBackfillVerified =
      historyDays >= 365 &&
      completeTransactionCoverage(business).complete &&
      !homeFailure &&
      (!home || completeTransactionCoverage(home).complete),
    archiveBaselineAudit = exactBackfillVerified
      ? archiveAudit
      : previousBank.archiveBaselineAudit || null;
  const nextBank = {
    ...previousBank,
    currentBalance: kupaWholeMoney(business.balance),
    ...bankSnapshotFinancials(business),
    updatedAt: new Date().toISOString(),
    asOfDate: checkTodayISO(),
    source: 'hapoalim',
    sourceAccount: businessAccount || null,
    bankSyncAt: fetchedAt,
    feed: businessFeed,
    homeFeed: nextHomeFeed,
    archiveInitialized: archiveReady || exactBackfillVerified,
    archiveVersion: exactBackfillVerified ? 2 : archiveVersion,
    archiveInitializedAt: archiveReady
      ? previousBank.archiveInitializedAt || null
      : exactBackfillVerified
        ? fetchedAt
        : null,
    archiveAudit,
    archiveBaselineAudit,
  };
  return { bank: financeBankPayload(nextBank), snapshotToken, snapshotSeq };
}

// This private model retains the established feed, backfill and reconciliation
// policies. It cannot acquire a lease, call a provider or publish a document.
export function createOrdersBankSnapshotPolicy() {
  return Object.freeze({
    accountId: accountIdOf,
    coverage: completeTransactionCoverage,
    audit: assertBankArchiveCoverage,
    build: buildSnapshot,
    transactions: (snapshot) => snapshot.transactions || [],
  });
}

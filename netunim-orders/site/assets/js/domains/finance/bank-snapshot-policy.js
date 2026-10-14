import {bankArchiveAccountId as accountIdOf,bankTransactionCoverage as completeTransactionCoverage} from '../../shared/bank-archive-policy.js';
import { bankSnapshotFinancials } from '../../shared/bank-balance-result.js';
import { bankRecurringDebitHistoryData } from '../../shared/bank-recurring-debits.js';
import { clone, uid } from '../../core/values.js';
import { checkTodayISO } from '../../core/dates.js';
import { kupaWholeMoney } from '../../core/money.js';
import { normalizeSharedBankEvents } from '../checks/model.js';
import { normalizeBankFeed } from './bank-feed.js';

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
export function createOrdersBankSnapshotPolicy(){return Object.freeze({build:buildSnapshot})}

// @ts-nocheck
import { CREDIT_PROVIDER_SCHEMA_VERSION } from './credit-adapter-wire.mjs';
import { enrichMaxTransaction } from './max-model.mjs';
import { normalizeCreditScrapeAccount } from './credit-transaction-model.mjs';
import { buildCreditMonthPlan } from './credit-month-plan.mjs';
import { monthlyCoverageSuccess } from './credit-coverage.mjs';

function transactionBillingDate(tx) {
  return tx?.processedDate || '';
}

function transactionMonth(tx) {
  const value = transactionBillingDate(tx);
  return value && /^\d{4}-\d{2}/.test(String(value)) ? String(value).slice(0, 7) : '';
}

export function genericMonthlyAccount(
  account,
  provider,
  { startDate, futureMonths, now },
  schemaVersion = CREDIT_PROVIDER_SCHEMA_VERSION
) {
  const source =
    provider === 'max' && Array.isArray(account?.txns)
      ? { ...account, txns: account.txns.map(enrichMaxTransaction) }
      : account;
  const normalized = normalizeCreditScrapeAccount(source, provider),
    plan = buildCreditMonthPlan({ startDate, futureMonths, now }),
    byMonth = new Map(plan.map((entry) => [entry.month, []])),
    pending = [],
    unassigned = [];
  for (const tx of normalized.txns) {
    // Provider status is authoritative. MAX and Isracard-group DigitalV3 intentionally set
    // processedDate on approvals to the purchase date, so processedDate must never promote
    // a pending authorization into a finalized billing-month transaction.
    if (tx.status === 'pending') {
      // The canonical boundary already deduplicates full observations with IDs.
      // A second, narrower ID/date/amount key would discard distinct approvals.
      pending.push(tx);
      continue;
    }
    // Membership in the planned calendar months is the only date cutoff.
    // A rolling-day filter here used to erase the first days of an otherwise
    // successful historical month, then overwrite Last Known Good on merge.
    const key = transactionMonth(tx);
    if (byMonth.has(key)) byMonth.get(key).push(tx);
    else if (!key) unassigned.push(tx);
  }
  return normalizeCreditScrapeAccount(
    {
      ...normalized,
      txns: undefined,
      pendingTransactions: pending,
      pendingStatus: 'success',
      pendingFetchedAt: now.toISOString(),
      unassignedTransactions: unassigned,
      months: plan.map((entry) =>
        monthlyCoverageSuccess(entry, byMonth.get(entry.month), now.toISOString(), schemaVersion)
      ),
    },
    provider
  );
}

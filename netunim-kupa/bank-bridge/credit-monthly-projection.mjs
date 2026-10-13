// @ts-nocheck
import { CREDIT_PROVIDER_SCHEMA_VERSION } from './credit-adapter-wire.mjs';
import { enrichMaxTransaction } from './max-model.mjs';
import { normalizeCreditScrapeAccount } from './lib.mjs';
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
    pendingSeen = new Set(),
    unassigned = [],
    cutoff = Date.parse(startDate);
  for (const tx of normalized.txns) {
    // Provider status is authoritative. MAX and Isracard-group DigitalV3 intentionally set
    // processedDate on approvals to the purchase date, so processedDate must never promote
    // a pending authorization into a finalized billing-month transaction.
    if (tx.status === 'pending') {
      const key = tx.id
        ? `${tx.id}|${tx.date || ''}|${tx.chargedAmount ?? tx.originalAmount ?? ''}`
        : '';
      if (!key || !pendingSeen.has(key)) {
        pending.push(tx);
        if (key) pendingSeen.add(key);
      }
      continue;
    }
    const billingDate = transactionBillingDate(tx),
      billingTime = Date.parse(billingDate),
      key = transactionMonth(tx);
    if (Number.isFinite(cutoff) && Number.isFinite(billingTime) && billingTime < cutoff) continue;
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

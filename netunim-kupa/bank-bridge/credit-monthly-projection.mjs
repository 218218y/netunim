// @ts-check
import { CREDIT_PROVIDER_SCHEMA_VERSION } from './credit-adapter-wire.mjs';
import { enrichMaxTransaction } from './max-model.mjs';
import { normalizeCreditScrapeAccount } from './credit-transaction-model.mjs';
import { buildCreditMonthPlan } from './credit-month-plan.mjs';
import { monthlyCoverageSuccess } from './credit-coverage.mjs';
import { isProviderList, providerRecord, safeError } from './credit-value-codec.mjs';

/** @typedef {import('./credit-model-contracts.js').CreditScrapeTransaction} CreditTransaction */

/** @param {CreditTransaction} tx */
function transactionBillingDate(tx) {
  return tx?.processedDate || '';
}

/** @param {CreditTransaction} tx @returns {string} */
function transactionMonth(tx) {
  const value = transactionBillingDate(tx);
  return value && /^\d{4}-\d{2}/.test(String(value)) ? String(value).slice(0, 7) : '';
}

/** @param {unknown} value */
function projectMaxTransaction(value) {
  const transaction = providerRecord(value);
  if (!transaction) {
    throw safeError('רשומת MAX אינה תקינה.', 'CREDIT_PROVIDER_SCHEMA_ERROR', { stage: 'Transactions' });
  }
  return enrichMaxTransaction(transaction);
}

/** @param {Record<string,unknown>} account @param {string} provider @param {{startDate:Date|string|number,futureMonths:number,now:Date}} options @param {string} [schemaVersion] */
export function genericMonthlyAccount(
  account,
  provider,
  { startDate, futureMonths, now },
  schemaVersion = CREDIT_PROVIDER_SCHEMA_VERSION
) {
  const source =
    provider === 'max' && isProviderList(account?.txns)
      ? { ...account, txns: account.txns.map(projectMaxTransaction) }
      : account;
  const normalized = normalizeCreditScrapeAccount(source, provider);
  const plannedMonths = buildCreditMonthPlan({ startDate, futureMonths, now }).map(entry => ({
    entry, transactions: /** @type {CreditTransaction[]} */ ([]),
  }));
  const byMonth = new Map(plannedMonths.map(({ entry, transactions }) => [entry.month, transactions]));
  /** @type {CreditTransaction[]} */
  const pending = [];
  /** @type {CreditTransaction[]} */
  const unassigned = [];
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
    if (key) byMonth.get(key)?.push(tx);
    else unassigned.push(tx);
  }
  return normalizeCreditScrapeAccount(
    {
      ...normalized,
      txns: undefined,
      pendingTransactions: pending,
      pendingStatus: 'success',
      pendingFetchedAt: now.toISOString(),
      unassignedTransactions: unassigned,
      months: plannedMonths.map(({ entry, transactions }) =>
        monthlyCoverageSuccess(entry, transactions, now.toISOString(), schemaVersion)
      ),
    },
    provider
  );
}

// @ts-check
import {normalizeBankFeedTransaction, normalizeBankFeed} from '../../shared/bank-feed.js';
import {bankTransactionSourceIdentity, bankTransactionMergeKey, overlayBankTransactionHistory} from '../../shared/bank-transaction-identity.js';
import {normalizeHapoalimTransaction} from '../../netunim-kupa/bank-bridge/hapoalim-transaction-model.mjs';

const historical = normalizeBankFeedTransaction({amount: null});
if (historical.amount !== null) {
  /** @type {number} */ const amount = historical.amount;
  amount.toFixed(2);
}
// @ts-expect-error missing historical money cannot become a known financial scalar
const requiredAmount = historical.amount.toFixed(2);
void requiredAmount;
const source = normalizeHapoalimTransaction({});
/** @type {number} */ const sourceAmount = source.amount;
sourceAmount.toFixed(2);
source.date.toUpperCase();
if (source.processedDate !== null) source.processedDate.toUpperCase();
const key = bankTransactionSourceIdentity(source);
if (key !== null) key.toUpperCase();
bankTransactionMergeKey(source, new Map()).toUpperCase();
const overlay = overlayBankTransactionHistory([source], [source]);
for (const entry of overlay) {
  /** @type {boolean} */ const refreshed = entry.current;
  void refreshed;
  entry.row.amount.toFixed(2);
}
const feed = normalizeBankFeed({});
if (feed) {
  feed.balance.toFixed(2);
  // @ts-expect-error optional financial evidence stays nullable
  feed.availableBalance.toFixed(2);
}

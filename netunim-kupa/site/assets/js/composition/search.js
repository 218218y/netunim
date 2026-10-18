import {createKupaSearchModel} from '../domains/search/model.js';
import {creditMonthlyDetailData, creditDetailItemIdentity} from '../domains/credit/model.js';
import {CREDIT_PROVIDER_LABELS} from '../domains/credit/sync-feed.js';
import {bankTransactionIdentity} from '../domains/bank/feed.js';
import {ledgerTypeLabel} from '../domains/cash/model.js';

export {KUPA_SEARCH_FRAGMENTS, searchKupaGlobalEntries} from '../domains/search/model.js';

export const {buildKupaGlobalSearchEntries, buildKupaSearchFragment, searchKupaGlobalData} = createKupaSearchModel({
  credit: {monthlyDetail: creditMonthlyDetailData, itemIdentity: creditDetailItemIdentity, providerLabels: CREDIT_PROVIDER_LABELS},
  bank: {transactionIdentity: bankTransactionIdentity},
  cash: {typeLabel: ledgerTypeLabel},
});

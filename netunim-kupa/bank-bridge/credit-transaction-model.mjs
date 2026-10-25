// @ts-check
import { creditNumber, creditText, creditTransactionTime } from './credit-core-values.mjs';
import {assertCreditTransactionEvidence,assertCreditProfileTransactions} from './credit-transaction-evidence.mjs';

/** @template Result @param {()=>Result} check @returns {Result} */
function assertProviderEvidence(check){
  try{return check()}catch(cause){
    throw Object.assign(new Error('Credit provider business evidence is invalid',{cause}),{
      code:'CREDIT_PROVIDER_SCHEMA_ERROR',stage:'Transactions',retryable:false,
    });
  }
}

/** @param {unknown} value @returns {value is 'success'|'provider_error'|'schema_error'|'network_error'} */
function isFetchStatus(value){return value==='success'||value==='provider_error'||value==='schema_error'||value==='network_error'}
/** @param {unknown} value @returns {value is 'fresh'|'stale'|'missing'} */
function frameStatus(value){return value==='fresh'||value==='stale'||value==='missing'}

/** @param {unknown} tx @returns {import('./credit-model-contracts.js').CreditScrapeTransaction} */
export function normalizeCreditScrapeTransaction(tx = {}) {
  const data=assertProviderEvidence(()=>{assertCreditTransactionEvidence(tx);return tx});
  const installments =
    data.installments && Number(data.installments.number) > 0 && Number(data.installments.total) > 0
      ? {
          number: Math.trunc(Number(data.installments.number)),
          total: Math.trunc(Number(data.installments.total)),
        }
      : null;
  return {
    id: creditText(data.id || data.identifier || '', 120),
    type: creditText(data.type || 'normal', 30) || 'normal',
    date: data.date || null,
    processedDate: data.processedDate || null,
    transactionDate: data.transactionDate || null,
    transactionTime: creditTransactionTime(data.transactionTime),
    originalAmount: creditNumber(data.originalAmount),
    originalCurrency: creditText(data.originalCurrency || '', 12),
    chargedAmount: creditNumber(data.chargedAmount),
    ...(data.chargeAmountStatus!==undefined
      ? { chargeAmountStatus: data.chargeAmountStatus }
      : {}),
    chargedCurrency: creditText(data.chargedCurrency || data.originalCurrency || 'ILS', 12) || 'ILS',
    foreignTransaction: data.foreignTransaction === true,
    description: creditText(data.description || 'עסקת אשראי', 220) || 'עסקת אשראי',
    memo: creditText(data.memo || '', 260),
    category: creditText(data.category || '', 160) || undefined,
    installments,
    status: data.status,
  };
}

/** @param {unknown} [values] @returns {import('./credit-model-contracts.js').CreditScrapeTransaction[]} */
function dedupeCreditScrapeTransactions(values = []) {
  const rows = [],
    seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const tx = normalizeCreditScrapeTransaction(value);
    if (!tx.id) {
      rows.push(tx);
      continue;
    }
    const key = JSON.stringify([
      tx.id,
      tx.status,
      tx.type,
      tx.date,
      tx.processedDate,
      tx.transactionDate,
      tx.transactionTime,
      tx.originalAmount,
      tx.originalCurrency,
      tx.chargedAmount,
      tx.chargedCurrency,
      tx.foreignTransaction,
      tx.description,
      tx.memo,
      tx.installments?.number ?? null,
      tx.installments?.total ?? null,
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(tx);
  }
  return rows;
}

/** @param {Record<string,unknown>} [slice] @returns {import('./credit-model-contracts.js').CreditMonthSlice} */
export function normalizeCreditMonthSlice(slice = {}) {
  assertProviderEvidence(()=>assertCreditProfileTransactions({accounts:[{months:[slice]}]}));
  const month = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(slice?.month || ''))
    ? String(slice.month)
    : '';
  const fetchStatus = isFetchStatus(slice.fetchStatus)
    ? slice.fetchStatus
    : 'provider_error';
  return {
    month,
    tier: slice?.tier === 'forecast' ? 'forecast' : 'core',
    status: fetchStatus === 'success' ? 'fresh' : 'missing',
    fetchStatus,
    fetchedAt: fetchStatus === 'success' && slice?.fetchedAt ? String(slice.fetchedAt) : null,
    transactions: dedupeCreditScrapeTransactions(slice?.transactions),
    providerSchemaVersion: creditText(slice?.providerSchemaVersion || '', 80),
    lastErrorCode:
      fetchStatus === 'success'
        ? ''
        : creditText(slice?.lastErrorCode || 'CREDIT_PROVIDER_DATA_ERROR', 80),
    lastErrorAt: fetchStatus === 'success' ? null : slice?.lastErrorAt || null,
  };
}

/** @param {Record<string,unknown>} [account] @param {string} [provider] @returns {import('./credit-model-contracts.js').CreditScrapeAccount} */
export function normalizeCreditScrapeAccount(account = {}, provider = '') {
  assertProviderEvidence(()=>assertCreditProfileTransactions({accounts:[account]}));
  const balance = creditNumber(account.balance),
    cardFrame = creditNumber(account.cardFrame),
    directAvailable = creditNumber(account.availableCredit);
  // israeli-bank-scrapers defines MAX balance as -(CreditLimit - OpenToBuy).
  // Since v6.10.0 Isracard/Amex use the same useful-credit semantics: balance is
  // negative utilized credit and cardFrame is the issuer limit. Therefore
  // cardFrame + balance is the issuer's exact available credit for those providers.
  // Cal is deliberately excluded: its balance is the next debit, not utilized credit.
  const issuerAvailable =
    ['max', 'isracard', 'amex'].includes(provider) && cardFrame !== null && balance !== null
      ? Math.round((cardFrame + balance) * 100) / 100
      : null;
  const months = (Array.isArray(account.months) ? account.months : [])
      .map(normalizeCreditMonthSlice)
      .filter((slice) => slice.month),
    pendingTransactions = dedupeCreditScrapeTransactions(account.pendingTransactions),
    unassignedTransactions = dedupeCreditScrapeTransactions(account.unassignedTransactions),
    legacyTransactions = dedupeCreditScrapeTransactions(account.txns),
    txns = months.length
      ? [
          ...months.flatMap((slice) => slice.transactions),
          ...pendingTransactions,
          ...unassignedTransactions,
        ]
      : legacyTransactions;
  const hasFrameValue = balance !== null || cardFrame !== null || directAvailable !== null,
    frameState = frameStatus(account.frameStatus)
      ? account.frameStatus
      : hasFrameValue
        ? 'fresh'
        : 'missing',
    frameFetchStatus = isFetchStatus(account.frameFetchStatus)||account.frameFetchStatus==='unavailable'
      ? account.frameFetchStatus
      : frameState === 'fresh'
        ? 'success'
        : 'unavailable';
  return {
    accountNumber: creditText(account.accountNumber || '', 80),
    balance,
    balanceDate: account.balanceDate || null,
    cardType: creditText(account.cardType || '', 80),
    cardFrame,
    availableCredit: directAvailable ?? issuerAvailable,
    frameStatus:frameState,
    frameFetchStatus,
    frameFetchedAt: account.frameFetchedAt || null,
    frameErrorCode: creditText(account.frameErrorCode || '', 80),
    frameErrorAt: account.frameErrorAt || null,
    months,
    pendingTransactions,
    pendingStatus: isFetchStatus(account.pendingStatus)||account.pendingStatus==='missing'
      ? account.pendingStatus
      : pendingTransactions.length
        ? 'success'
        : 'missing',
    pendingFetchedAt: account.pendingFetchedAt || null,
    pendingErrorCode: creditText(account.pendingErrorCode || '', 80),
    pendingErrorAt: account.pendingErrorAt || null,
    unassignedTransactions,
    txns,
  };
}

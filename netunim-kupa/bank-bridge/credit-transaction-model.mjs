// @ts-nocheck
import { creditNumber, creditText, creditTransactionTime } from './credit-core-values.mjs';
import {assertCreditTransactionEvidence,assertCreditProfileTransactions} from './credit-transaction-evidence.mjs';

function assertProviderEvidence(check){
  try{check()}catch(cause){
    throw Object.assign(new Error('Credit provider business evidence is invalid',{cause}),{
      code:'CREDIT_PROVIDER_SCHEMA_ERROR',stage:'Transactions',retryable:false,
    });
  }
}

export function normalizeCreditScrapeTransaction(tx = {}) {
  assertProviderEvidence(()=>assertCreditTransactionEvidence(tx));
  const installments =
    Number(tx?.installments?.number) > 0 && Number(tx?.installments?.total) > 0
      ? {
          number: Math.trunc(Number(tx.installments.number)),
          total: Math.trunc(Number(tx.installments.total)),
        }
      : null;
  return {
    id: creditText(tx.id || tx.identifier || '', 120),
    type: creditText(tx.type || 'normal', 30) || 'normal',
    date: tx.date || null,
    processedDate: tx.processedDate || null,
    transactionDate: tx.transactionDate || null,
    transactionTime: creditTransactionTime(tx.transactionTime),
    originalAmount: creditNumber(tx.originalAmount),
    originalCurrency: creditText(tx.originalCurrency || '', 12),
    chargedAmount: creditNumber(tx.chargedAmount),
    ...(['reported', 'missing', 'not_billed'].includes(tx.chargeAmountStatus)
      ? { chargeAmountStatus: tx.chargeAmountStatus }
      : {}),
    chargedCurrency: creditText(tx.chargedCurrency || tx.originalCurrency || 'ILS', 12) || 'ILS',
    foreignTransaction: tx.foreignTransaction === true,
    description: creditText(tx.description || 'עסקת אשראי', 220) || 'עסקת אשראי',
    memo: creditText(tx.memo || '', 260),
    category: creditText(tx.category || '', 160) || undefined,
    installments,
    status: tx.status,
  };
}

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

export function normalizeCreditMonthSlice(slice = {}) {
  assertProviderEvidence(()=>assertCreditProfileTransactions({accounts:[{months:[slice]}]}));
  const month = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(slice?.month || ''))
    ? String(slice.month)
    : '';
  const fetchStatus = ['success', 'provider_error', 'schema_error', 'network_error'].includes(
    String(slice?.fetchStatus)
  )
    ? String(slice.fetchStatus)
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
    frameStatus = ['fresh', 'stale', 'missing'].includes(String(account.frameStatus))
      ? String(account.frameStatus)
      : hasFrameValue
        ? 'fresh'
        : 'missing',
    frameFetchStatus = [
      'success',
      'unavailable',
      'provider_error',
      'schema_error',
      'network_error',
    ].includes(String(account.frameFetchStatus))
      ? String(account.frameFetchStatus)
      : frameStatus === 'fresh'
        ? 'success'
        : 'unavailable';
  return {
    accountNumber: creditText(account.accountNumber || '', 80),
    balance,
    balanceDate: account.balanceDate || null,
    cardType: creditText(account.cardType || '', 80),
    cardFrame,
    availableCredit: directAvailable ?? issuerAvailable,
    frameStatus,
    frameFetchStatus,
    frameFetchedAt: account.frameFetchedAt || null,
    frameErrorCode: creditText(account.frameErrorCode || '', 80),
    frameErrorAt: account.frameErrorAt || null,
    months,
    pendingTransactions,
    pendingStatus: ['success', 'provider_error', 'schema_error', 'network_error'].includes(
      String(account.pendingStatus)
    )
      ? String(account.pendingStatus)
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

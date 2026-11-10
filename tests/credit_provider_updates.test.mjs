import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVisaCalTransaction,
  parseVisaCalMonthData,
  parseVisaCalPending,
} from '../netunim-kupa/bank-bridge/visa-cal-model.mjs';
import { normalizeMaxRawTransaction } from '../netunim-kupa/bank-bridge/max-model.mjs';
import { normalizeCreditScrapeAccount } from '../netunim-kupa/bank-bridge/credit-transaction-model.mjs';
import { genericMonthlyAccount } from '../netunim-kupa/bank-bridge/credit-monthly-projection.mjs';
import { creditBillingRowsData } from '../shared/credit-billing-cycles.js';

function cal(overrides = {}) {
  return {
    trnIntId: 'synthetic-cal',
    trnTypeCode: '41',
    trnPurchaseDate: '2026-10-03T12:34:56',
    debCrdDate: '2026-10-15T00:00:00',
    numOfPayments: 0,
    curPaymentNum: 0,
    trnAmt: 12.5,
    amtBeforeConvAndIndex: 46.25,
    trnCurrencySymbol: 'USD',
    debCrdCurrencySymbol: 'ILS',
    merchantName: 'Synthetic merchant',
    transTypeCommentDetails: 'Original memo',
    ...overrides,
  };
}

function max(overrides = {}) {
  return {
    shortCardNumber: '0042',
    purchaseDate: '2026-10-03T12:34:56',
    paymentDate: '2026-10-15',
    merchantName: 'Synthetic merchant',
    originalAmount: 150,
    originalCurrency: 'ILS',
    actualPaymentAmount: 137.66,
    paymentCurrency: 'ILS',
    dealData: { arn: 'synthetic-max' },
    ...overrides,
  };
}

test('CAL code 41 changes only classification, preserving completed debit fields', () => {
  const raw = cal(), before = structuredClone(raw);
  assert.deepEqual(normalizeVisaCalTransaction(raw), {
    id: 'synthetic-cal', type: 'normal', status: 'completed',
    date: '2026-10-03T12:34:56.000Z', processedDate: '2026-10-15T00:00:00.000Z',
    transactionDate: '2026-10-03T12:34:56.000Z', transactionTime: '12:34',
    originalAmount: -12.5, originalCurrency: 'USD',
    chargedAmount: -46.25, chargedCurrency: 'ILS', chargeAmountStatus: 'reported',
    foreignTransaction: false, description: 'Synthetic merchant', memo: 'Original memo',
    category: undefined, installments: null,
  });
  assert.deepEqual(raw, before);
});

test('CAL keeps its existing string coercion for codes in completed and pending rows', () => {
  for (const [code, type] of [
    ['41', 'normal'], [41, 'normal'], ['5', 'normal'], [5, 'normal'],
    ['9', 'normal'], ['8', 'installments'], ['6', 'installments'],
    ['42', 'installments'], ['76', 'installments'], ['999', 'installments'],
    [undefined, 'installments'], [null, 'installments'],
  ]) {
    for (const debCrdDate of ['2026-10-15', null, undefined]) {
      const tx = normalizeVisaCalTransaction(cal({ trnTypeCode: code, debCrdDate }));
      assert.equal(tx.type, type, `${code}, billing ${debCrdDate}`);
      assert.equal(tx.status, debCrdDate ? 'completed' : 'pending');
      assert.equal(tx.installments, null);
    }
  }
});

test('CAL retains installment metadata, month-end dates, refunds and missing charges', () => {
  for (const fields of [
    { numOfPayments: 4, curPaymentNum: 2, trnPurchaseDate: '2026-01-31T10:00:00' },
    { debCrdDate: null, numberOfPayments: 4 },
    { trnAmt: -12.5, amtBeforeConvAndIndex: -46.25 },
    { amtBeforeConvAndIndex: null },
  ]) {
    const tx = normalizeVisaCalTransaction(cal(fields));
    const previousClassification = normalizeVisaCalTransaction(cal({ ...fields, trnTypeCode: '8' }));
    assert.deepEqual(tx, { ...previousClassification, type: 'normal' });
  }
  const installment = normalizeVisaCalTransaction(cal({
    trnTypeCode: '8', numOfPayments: 4, curPaymentNum: 2,
    trnPurchaseDate: '2026-01-31T10:00:00',
  }));
  assert.equal(installment.date, '2026-02-28T00:00:00.000Z');
  assert.deepEqual(installment.installments, { number: 2, total: 4 });
  const refund = normalizeVisaCalTransaction(cal({ trnTypeCode: '6' }));
  assert.equal(refund.originalAmount, 12.5);
  assert.equal(refund.chargedAmount, -46.25);
});

test('CAL regular, immediate and pending branches preserve multiplicity and classify debit rows', () => {
  const data = { statusCode: 1, result: { bankAccounts: [{
    debitDates: [{ transactions: [cal(), cal()] }],
    immidiateDebits: { debitDays: [{ transactions: [cal({ trnIntId: 'immediate' })] }] },
  }] } };
  const rows = parseVisaCalMonthData(data);
  assert.deepEqual(rows.map(tx => [tx.id, tx.type]), [
    ['synthetic-cal', 'normal'], ['synthetic-cal', 'normal'], ['immediate', 'normal'],
  ]);
  const pending = parseVisaCalPending({ statusCode: 1, result: { cardsList: [{
    authDetalisList: [cal({ debCrdDate: null })],
  }] } });
  assert.equal(pending[0].type, 'normal');
  assert.equal(pending[0].id, '');
  assert.equal(pending[0].chargedAmount, -12.5);
});

test('local identities already retain different CAL installments with the same issuer ID', () => {
  const txns = [1, 2].map(number => normalizeVisaCalTransaction(cal({
    trnTypeCode: '8', numOfPayments: 2, curPaymentNum: number,
    debCrdDate: number === 1 ? '2026-10-15' : '2026-11-15',
  })));
  const account = normalizeCreditScrapeAccount({ accountNumber: '0042', txns: [...txns, txns[0]] });
  assert.equal(account.txns.length, 2, 'only the exact repeated row is removed');
  assert.deepEqual(account.txns.map(tx => tx.id), ['synthetic-cal', 'synthetic-cal']);
  const state = { creditSync: { profiles: [{
    profileId: 'cal', provider: 'visaCal', defaultAccount: 'עסקי', accounts: [account],
  }], cardMappings: { 'cal:0042': { included: true, account: 'עסקי' } } } };
  const rows = creditBillingRowsData(state, { asOf: '2026-10-01' });
  assert.equal(rows.length, 2, 'billing consumers retain each installment');
  assert.equal(new Set(rows.map(row => row.creditId)).size, 2);
});

for (const [label, fields, expected] of [
  ['absent', {}, 'comment Recipient: Transfer'],
  ['null', { promotionClub: null, promotionAmount: null }, 'comment Recipient: Transfer'],
  ['blank', { promotionClub: '  ', promotionAmount: '' }, 'comment Recipient: Transfer'],
  ['club and discount', { promotionClub: 'Club discount', promotionAmount: -12.34 }, 'comment Recipient: Transfer | Club discount: -12.34'],
  ['club only', { promotionClub: 'Club discount' }, 'comment Recipient: Transfer | Club discount'],
  ['amount only', { promotionAmount: -12.34 }, 'comment Recipient: Transfer | -12.34'],
  ['zero', { promotionClub: 'Club discount', promotionAmount: 0 }, 'comment Recipient: Transfer | Club discount: 0'],
  ['positive', { promotionAmount: 12.34 }, 'comment Recipient: Transfer | 12.34'],
]) {
  test(`MAX promotion memo: ${label}, all other fields unchanged`, () => {
    const base = max({ comments: 'comment', fundsTransferReceiverOrTransfer: 'Recipient', fundsTransferComment: 'Transfer' });
    const raw = { ...base, ...fields }, before = structuredClone(raw);
    const tx = normalizeMaxRawTransaction(raw);
    const original = normalizeMaxRawTransaction(base);
    assert.equal(tx.memo, expected);
    assert.deepEqual(tx, { ...original, memo: expected, rawTransaction: raw });
    assert.deepEqual(raw, before);
    assert.equal(tx.chargedAmount, -137.66, 'the discount must never be applied twice');
  });
}

test('MAX promotion-only and transfer-detail-only memos keep local formatting', () => {
  assert.equal(normalizeMaxRawTransaction(max({ promotionClub: 'Club', promotionAmount: -12.34 })).memo, 'Club: -12.34');
  assert.equal(normalizeMaxRawTransaction(max({ fundsTransferComment: 'Transfer', promotionAmount: 0 })).memo, 'Transfer | 0');
  assert.equal(normalizeMaxRawTransaction(max({ comments: '2 מתוך 4', promotionClub: 'Club' })).installments.number, 2);
});

test('MAX monthly projection carries promotion details through completed and pending normalization', () => {
  const txns = [
    normalizeMaxRawTransaction(max({ promotionClub: 'Club', promotionAmount: -12.34 })),
    normalizeMaxRawTransaction(max({ paymentDate: null, promotionAmount: 0, originalAmount: -150, actualPaymentAmount: -137.66 })),
  ];
  const result = genericMonthlyAccount({ accountNumber: '0042', txns }, 'max', {
    startDate: new Date('2026-10-01'), futureMonths: 0, now: new Date('2026-10-10'),
  });
  assert.equal(result.months[0].transactions[0].memo, 'Club: -12.34');
  assert.equal(result.months[0].transactions[0].chargedAmount, -137.66);
  assert.equal(result.pendingTransactions[0].memo, '0');
  assert.equal(result.pendingTransactions[0].chargedAmount, 137.66);
  assert.ok(!JSON.stringify(result).includes('rawTransaction'));
});

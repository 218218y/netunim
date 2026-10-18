import { readerFixture } from './bank_reader_fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readBankBalanceResult, bankSnapshotFinancials } from '../shared/bank-balance-result.js';

const optional = ['availableBalance', 'creditLimit', 'creditLimitUsed', 'creditLimitUsedPercent'];
test('complete Bank coverage requires a transaction array before it can imply absence',()=>{
  for(const role of ['business','home'])for(const transactions of [undefined,null,{},false,'',1]){
    assert.throws(()=>readBankBalanceResult({accounts:{business:{balance:200},
      [role]:{balance:100,transactionCoverage:{complete:true},transactions}}}),{code:'BANK_TRANSACTIONS_INVALID'});
  }
  assert.equal(readBankBalanceResult({fetchedAt:'2026-10-13T00:00:00Z',accounts:{business:{balance:0,transactionCoverage:{complete:true},transactions:[]}}}).business.balance,0);
  assert.equal(readBankBalanceResult({balance:100}).business.balance,100,'legacy balance-only results do not claim complete transaction coverage');
});
for (const value of [
  null,
  undefined,
  '',
  '  ',
  false,
  true,
  [],
  [0],
  {},
  NaN,
  Infinity,
  -Infinity,
  'NaN',
  'Infinity',
]) {
  test(`Bank required balance rejects coercible/missing evidence ${String(value)}`, () => {
    for (const role of ['business', 'home']) {
      const accounts = { business: { balance: 200 }, [role]: { balance: value } };
      assert.throws(
        () => readBankBalanceResult({ accounts }),
        (error) => error.code === 'BANK_BALANCE_INVALID' && !error.message.includes('private')
      );
    }
  });
  test(`Bank optional money preserves unknown evidence ${String(value)}`, () => {
    const account = { balance: 200 };
    for (const field of optional) account[field] = value;
    const result = readBankBalanceResult(account),
      fields = bankSnapshotFinancials(result.business);
    for (const field of optional) {
      assert.equal(result.business[field], null, field);
      assert.equal(fields[field], null, field);
    }
  });
}
for (const [value, expected] of [
  [0, 0],
  ['0', 0],
  [-25.75, -25.75],
  [' -25.75 ', -25.75],
  ['2.5e2', 250],
  [450, 450],
])
  test(`Bank preserves explicit finite evidence ${value}`, () => {
    const raw = {
      balance: value,
      availableBalance: value,
      creditLimit: value,
      creditLimitUsed: value,
      creditLimitUsedPercent: value,
      accountNumber: '0012',
    };
    const result = readBankBalanceResult({ accounts: { business: raw, home: raw } });
    for (const account of [result.business, result.home]) {
      assert.equal(account.balance, expected);
      for (const field of optional) assert.equal(bankSnapshotFinancials(account)[field], expected);
    }
    assert.equal(result.business.accountNumber, '0012');
    assert.equal(raw.balance, value);
  });
test('Bank evidence cannot be forged, copied, mutated or restored from persisted JSON without decoding', () => {
  const result = readBankBalanceResult({ balance: 100 });
  assert.throws(() => {
    result.business.balance = 0;
  }, TypeError);
  for (const forged of [
    { balance: 0 },
    { ...result.business },
    JSON.parse(JSON.stringify(result.business)),
    null,
  ])
    assert.throws(
      () => bankSnapshotFinancials(forged),
      (error) => error.code === 'BANK_BALANCE_INVALID'
    );
  assert.equal(
    bankSnapshotFinancials(
      readBankBalanceResult(JSON.parse(JSON.stringify(result.business))).business
    ).availableBalance,
    null
  );
  assert.deepEqual(
    Object.keys(JSON.parse(JSON.stringify(result.business))).sort(),
    ['balance', ...optional].sort()
  );
});
test('Bank flat/dual-account formats preserve transaction identities and partial-home failure metadata', () => {
  const transaction = { id: 'unchanged', amount: -12, currency:'ILS',status:'completed' },
    homeFailure = { code: 'ACCOUNT_NOT_FOUND', availableAccounts: [{ accountNumber: '0056' }] },
    raw = {
      fetchedAt: '2026-10-13T00:00:00Z',
      accounts: { business: { balance: 100, transactions: [transaction] }, home: null },
      accountFailures: { home: homeFailure },
    };
  const result = readBankBalanceResult(raw);
  assert.equal(result.source.fetchedAt, raw.fetchedAt);
  assert.deepEqual(result.business.transactions[0], transaction);
  assert.notEqual(result.business.transactions[0], transaction);
  assert.equal(result.homeFailure, homeFailure);
  assert.equal(result.home, null);
  assert.equal(
    readBankBalanceResult({ fetchedAt: raw.fetchedAt, balance: '0', transactions: [transaction] }).business.balance,
    0
  );
  // Existing partial-home presence semantics do not disappear during money validation.
  assert.equal(
    readBankBalanceResult({ ...raw, accountFailures: { home: 'failure' } }).homeFailure,
    'failure'
  );
});
test('Bank never invokes coercion on object-valued financial fields', () => {
  let calls = 0;
  const value = {
    valueOf: () => {
      calls++;
      return 0;
    },
  };
  assert.throws(
    () => readBankBalanceResult({ balance: value }),
    (error) => error.code === 'BANK_BALANCE_INVALID'
  );
  assert.equal(
    readBankBalanceResult({ balance: 0, creditLimit: value }).business.creditLimit,
    null
  );
  assert.equal(calls, 0);
});

for (const currentBalance of [null, '', false, []])
  test(
    'actual Hapoalim reader rejects absent/coercible bank API balance ' +
      JSON.stringify(currentBalance),
    async () => {
      const f = readerFixture({
        respond: (url) =>
          url.pathname.endsWith('balanceAndCreditLimit')
            ? { currentBalance }
            : { transactions: [] },
      });
      await assert.rejects(
        () => f.api.read(f.page, { diagnosticRun: f.run }),
        (error) => error.code === 'NO_BALANCE' && error.stage === 'balance'
      );
      assert.equal(
        f.calls.filter((row) => row[0] === 'request').length,
        1,
        'invalid balance must stop before transaction requests'
      );
    }
  );
test('actual Hapoalim reader keeps unavailable optional money unknown', async () => {
  const f = readerFixture({
    respond: (url) =>
      url.pathname.endsWith('balanceAndCreditLimit')
        ? {
            currentBalance: 42,
            withdrawalBalance: null,
            creditLimitAmount: null,
            creditLimitUtilizationAmount: null,
            creditLimitUtilizationPercent: null,
          }
        : { transactions: [] },
  });
  const result = await f.api.read(f.page, { diagnosticRun: f.run });
  for (const field of optional) assert.equal(result[field], null, field);
});

test('actual Hapoalim missing home balance remains a partial-home failure while valid business data survives', async () => {
  const f = readerFixture({
    accounts: [
      { bankNumber: 12, branchNumber: 345, accountNumber: 678901, accountClosingReasonCode: 0 },
      { bankNumber: 12, branchNumber: 346, accountNumber: 678902, accountClosingReasonCode: 0 },
    ],
    respond: (url) =>
      url.pathname.endsWith('balanceAndCreditLimit')
        ? { currentBalance: url.searchParams.get('accountId').endsWith('678902') ? null : 42 }
        : { transactions: [] },
  });
  const result = await f.api.read(f.page, {
    businessBranchNumber: '345',
    businessAccountNumber: '678901',
    homeBranchNumber: '346',
    homeAccountNumber: '678902',
    diagnosticRun: f.run,
  });
  assert.equal(result.accounts.business.balance, 42);
  assert.equal(result.accounts.home, null);
  assert.equal(result.accountFailures.home.code, 'NO_BALANCE');
  assert.equal(result.accountFailures.home.stage, 'balance');
});

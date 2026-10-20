import test from 'node:test';
import assert from 'node:assert/strict';
import { readerFixture } from './bank_reader_fixture.mjs';
const credentials = { businessBranchNumber: '345', businessAccountNumber: '678901' };
const row = (date, serial = 1) => ({
  eventDate: date,
  valueDate: date,
  eventActivityTypeCode: 1,
  eventAmount: 7,
  serialNumber: serial,
  referenceNumber: 123,
  activityDescription: 'fixture transfer',
});

test('an unreported or invalid page size never proves complete bank coverage', async () => {
  for (const size of [undefined, null, '', true, [], 150.5, -1, 0]) {
    const f = readerFixture({respond: async url => url.pathname.endsWith('balanceAndCreditLimit')
      ? {currentBalance: 42} : {numItemsPerPage: size, transactions: Array.from({length: 150}, (_, i) => row('20261013', i))}});
    const result = await f.api.read(f.page, credentials, f.ready, 4);
    assert.equal(result.transactionCoverage.complete, false, String(size));
    assert.equal(result.transactions.length, 150);
    assert.ok(result.transactionWarning);
    assert.equal(f.calls.filter(call => call[0] === 'request' && call[1].url.includes('/transactions?')).length, 1,
      'unknown capacity must not fan out into unbounded date requests');
  }
});

test('a failed later window retains validated rows from successful windows without absence authority', async () => {
  let windows = 0;
  const f = readerFixture({respond: async url => url.pathname.endsWith('balanceAndCreditLimit')
    ? {currentBalance: 42} : ++windows === 1
      ? {numItemsPerPage: 150, transactions: [row('20261013')]}
      : {httpFailure: 403}});
  const result = await f.api.read(f.page, credentials, f.ready, 90);
  assert.equal(result.balance, 42);
  assert.equal(result.transactionCoverage.complete, false);
  assert.equal(result.transactions.length, 1);
  assert.ok(result.transactionWarning);
});

test('reported capacity proves a short page but never a saturated single day', async () => {
  for (const count of [149, 150]) {
    const f = readerFixture({respond: async url => url.pathname.endsWith('balanceAndCreditLimit')
      ? {currentBalance: 42} : {numItemsPerPage: '150', transactions: Array.from({length: count}, (_, i) => row('20261013', i))}});
    const result = await f.api.read(f.page, credentials, f.ready, 1);
    assert.equal(result.transactionCoverage.complete, count === 149);
    assert.equal(result.transactions.length, count);
  }
});

test('bank account reader selects only open configured roles and preserves a partial home failure', async () => {
  const f = readerFixture({
    accounts: [
      { bankNumber: 12, branchNumber: 345, accountNumber: 678901, accountClosingReasonCode: 0 },
      { bankNumber: 12, branchNumber: 345, accountNumber: 111111, accountClosingReasonCode: 0 },
      { bankNumber: 12, branchNumber: 345, accountNumber: 999999, accountClosingReasonCode: 1 },
    ],
    respond: async (url) =>
      url.pathname.endsWith('balanceAndCreditLimit')
        ? url.searchParams.get('accountId').endsWith('111111')
          ? { httpFailure: 503 }
          : { currentBalance: 42 }
        : { numItemsPerPage: 150, transactions: [] },
  });
  const result = await f.api.read(
    f.page,
    { ...credentials, homeBranchNumber: '345', homeAccountNumber: '111111' },
    f.ready,
    4,
    { diagnosticRun: f.run }
  );
  assert.equal(result.balance, 42);
  assert.equal(result.accounts.home, null);
  assert.equal(result.accountFailures.home.accountRole, 'home');
  assert.equal(result.accountFailures.home.stage, 'balance');
  assert.equal(result.accountFailures.home.httpStatus, 503);
  assert.equal(result.accounts.business.transactionCoverage.complete, true);
  const duplicate = await f.api.read(
    f.page,
    { ...credentials, homeBranchNumber: '345', homeAccountNumber: '678901' },
    f.ready,
    1
  );
  assert.equal(duplicate.accountFailures.home.code, 'DUPLICATE_ACCOUNT_ROLE');
});

test('reported full pages split into non-overlapping days and retain all capped single-day rows', async () => {
  const f = readerFixture({
    respond: async (url) =>
      url.pathname.endsWith('balanceAndCreditLimit')
        ? { currentBalance: 42 }
        : { numItemsPerPage: 1, transactions: [row(url.searchParams.get('retrievalStartDate'))] },
  });
  const result = await f.api.read(f.page, credentials, f.ready, 4, { diagnosticRun: f.run });
  const windows = f.calls
    .filter((call) => call[0] === 'request' && call[1].url.includes('/transactions?'))
    .map((call) => {
      const url = new URL(call[1].url);
      return [url.searchParams.get('retrievalStartDate'), url.searchParams.get('retrievalEndDate')];
    });
  assert.deepEqual(windows, [
    ['20261010', '20261013'],
    ['20261010', '20261011'],
    ['20261010', '20261010'],
    ['20261011', '20261011'],
    ['20261012', '20261013'],
    ['20261012', '20261012'],
    ['20261013', '20261013'],
  ]);
  assert.equal(result.transactions.length, 4);
  assert.equal(result.transactionCoverage.complete, false);
  assert.ok(result.transactionWarning);
  const request = f.calls.find((call) => call[0] === 'request' && call[1].method === 'POST')[1];
  assert.equal(request.body, '[]');
  assert.equal(request.headers['X-XSRF-TOKEN'], 'fixture-xsrf');
});

test('all returned transactions survive normalization without a hidden limit or duplicate trim', async () => {
  const f = readerFixture({
    respond: async (url) =>
      url.pathname.endsWith('balanceAndCreditLimit')
        ? { currentBalance: 42 }
        : { numItemsPerPage: 150, transactions: [row('20261013'), row('20261013')] },
  });
  const result = await f.api.read(f.page, credentials, f.ready, 1);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.transactionCoverage.complete, true);
});

test('transaction failure keeps a valid balance with incomplete coverage while invalid balance fails the command', async () => {
  const f = readerFixture({
    respond: async (url) =>
      url.pathname.endsWith('balanceAndCreditLimit')
        ? { currentBalance: 42 }
        : { httpFailure: 403 },
  });
  const result = await f.api.read(f.page, credentials, f.ready, 4);
  assert.equal(result.balance, 42);
  assert.equal(result.transactionCoverage.complete, false);
  assert.equal(result.transactions.length, 0);
  assert.ok(result.transactionWarning);
  const invalid = readerFixture({ respond: async () => ({ currentBalance: 'not numeric' }) });
  await assert.rejects(invalid.api.read(invalid.page, credentials, invalid.ready), {
    code: 'NO_BALANCE',
    stage: 'balance',
  });
});

test('bank JSON retries only transient navigation and discards ready state belonging to another page URL', async () => {
  let attempts = 0;
  const f = readerFixture({
    respond: async () => {
      if (++attempts === 1) throw new Error('Execution context was destroyed');
      return { fixture: 42 };
    },
  });
  const result = await f.api.json.read(
    f.page,
    async () => ({ url: 'https://login.bankhapoalim.co.il/fixture' }),
    { initialReady: { ready: true, href: 'old-page' } }
  );
  assert.equal(result.data.fixture, 42);
  assert.equal(attempts, 2);
  assert.equal(f.calls.filter((call) => call[0] === 'ready').length, 2);
  let denied = 0;
  const blocked = readerFixture({
    respond: async () => {
      denied++;
      return { httpFailure: 403 };
    },
  });
  await assert.rejects(
    blocked.api.json.read(
      blocked.page,
      async () => ({ url: 'https://login.bankhapoalim.co.il/fixture' }),
      { initialReady: blocked.ready }
    ),
    { code: 'HAPOALIM_API_ERROR', httpStatus: 403 }
  );
  assert.equal(denied, 1);
});

test('pending cheque rows skip detail requests and cheque images attach only to separate structured detail results', async () => {
  const attached = [];
  const f = readerFixture({
    respond: async (url) => ({
      list: [{ bankNumber: 12, branchNumber: 345, accountNumber: 678901, number: 7, amount: 7 }],
      referenceNumber: 999,
    }),
    attach: async (page, transaction, payload, normalized) => {
      attached.push(normalized);
      return normalized;
    },
  });
  const pending = {
    ...row('20261013', 0),
    activityDescription: 'הפק.שיק בסלולאר',
    pfmDetails: '/ServerServices/fixture',
    details: '/ServerServices/detail',
  };
  await f.api.enrich(f.page, [pending], '12-345-678901', {
    initialReady: f.ready,
    diagnosticRun: f.run,
  });
  assert.equal(f.calls.length, 0);
  await f.api.enrich(f.page, [{ ...pending, serialNumber: 1 }], '12-345-678901', {
    initialReady: f.ready,
    diagnosticRun: f.run,
  });
  assert.equal(attached.length, 1);
  assert.equal(f.calls.filter((call) => call[0] === 'request').length, 2);
});

test('issuer enrichment keeps pending debits intact and fetches a shared posted detail link once', async () => {
  const f = readerFixture({
    respond: async () => ({ cards: [{ cardNumber: '4580-1234-1234-1234' }] }),
  });
  const link = '/ServerServices/current-account/permissions/fixture';
  const pending = {
    ...row('20261013', 0),
    eventActivityTypeCode: 2,
    englishActionDesc: 'MAX',
    pfmDetails: link,
    details: link,
  };
  const skipped = await f.api.enrich(f.page, [pending], '12-345-678901', {
    initialReady: f.ready,
    diagnosticRun: f.run,
  });
  assert.equal(skipped.transactions[0], pending);
  assert.equal(f.calls.length, 0);
  const posted = await f.api.enrich(f.page, [{ ...pending, serialNumber: 1 }], '12-345-678901', {
    initialReady: f.ready,
    diagnosticRun: f.run,
  });
  assert.deepEqual(posted.transactions[0].netunimCreditSettlementDetails, {
    cardLast4s: ['1234'],
    detailFetched: true,
  });
  assert.equal(f.calls.filter((call) => call[0] === 'request').length, 1);
  const denied = readerFixture({ respond: async () => ({ httpFailure: 403 }) });
  const failed = await denied.api.enrich(
    denied.page,
    [{ ...pending, serialNumber: 1 }],
    '12-345-678901',
    { initialReady: denied.ready, diagnosticRun: denied.run }
  );
  assert.equal(failed.transactions[0].eventAmount, 7);
  assert.equal(failed.transactions[0].netunimCreditSettlementDetails.detailFetched, false);
  assert.ok(failed.transactions[0].netunimCreditSettlementDetails.warning);
  assert.equal(denied.calls.filter((call) => call[0] === 'request').length, 1);
});

test('initial backfill requests every day exactly once within the existing 365-day bound', async () => {
  const f = readerFixture(),
    result = await f.api.read(f.page, credentials, f.ready, 9999),
    days = new Set();
  assert.equal(result.transactionCoverage.days, 365);
  assert.equal(result.transactionCoverage.from, '2025-10-14');
  assert.equal(result.transactionCoverage.to, '2026-10-13');
  assert.equal(result.transactionCoverage.complete, true);
  const windows = f.calls.filter(
    (call) => call[0] === 'request' && call[1].url.includes('/transactions?')
  );
  assert.equal(windows.length, 7);
  for (const [, request] of windows) {
    const query = new URL(request.url).searchParams,
      parse = (value) =>
        Date.UTC(
          Number(value.slice(0, 4)),
          Number(value.slice(4, 6)) - 1,
          Number(value.slice(6, 8))
        ) / 86400000;
    const start = parse(query.get('retrievalStartDate')),
      end = parse(query.get('retrievalEndDate'));
    assert.ok(end - start < 60);
    for (let day = start; day <= end; day++) {
      assert.equal(days.has(day), false, 'backfill windows must not overlap');
      days.add(day);
    }
  }
  assert.equal(days.size, 365);
});

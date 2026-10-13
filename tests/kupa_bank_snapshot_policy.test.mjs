import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { creditAdapterPolicyHashes } from './credit_adapter_policy_fixture.mjs';
import { wholeMoney } from '../netunim-kupa/site/assets/js/core/money.js';
import { normalizeBankFeed } from '../netunim-kupa/site/assets/js/domains/bank/feed.js';
import { createManualBankSnapshot } from '../netunim-kupa/site/assets/js/domains/bank/manual-snapshot.js';
const read = (name) =>
  JSON.parse(fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
const manual = read('kupa-bank-manual-command.json'),
  archive = read('kupa-bank-archive-preserved-policy.json');
const stamp = '2026-10-13T10:00:00.000Z',
  environment = {
    now: () => stamp,
    today: () => stamp.slice(0, 10),
    createToken: () => 'BANK-fixture',
  };
test('manual reference is the immutable pre-extraction command, not the new implementation', () => {
  assert.equal(
    creditAdapterPolicyHashes([manual.source]).policies.commitBankSnapshot,
    archive.policies.commitBankSnapshot
  );
});
test('manual projection retains pre-extraction money, watermark, unchanged-feed and explicit-reset behavior', async () => {
  const before = {
    currentBalance: 100,
    snapshotToken: 'before',
    snapshotSeq: 1,
    adjustments: [{ amount: 12 }],
    bankSyncAt: '2026-10-08T01:00:00Z',
    feed: { accountNumber: 'business', balance: 100, transactions: [{ id: 'retained' }] },
    homeFeed: { accountNumber: 'home', balance: 50, transactions: [] },
    future_field: { retained: true },
  };
  for (const amount of [500, 12.5, -12.5, 0])
    for (const options of [
      {},
      { bankSyncAt: null, bankFeed: null, homeBankFeed: null },
      {
        bankSyncAt: stamp,
        bankFeed: { accountNumber: 'new', balance: 500, transactions: [{ id: 'new' }] },
      },
      {
        source: 'hapoalim',
        accountNumber: 'business',
        homeBankFeed: { accountNumber: 'home-new', balance: 50, transactions: [] },
      },
    ]) {
      let expected;
      class FixedDate extends Date {
        constructor(...args) {
          super(...(args.length ? args : [stamp]));
        }
      }
      const scope = vm.createContext({
        Date: FixedDate,
        model: { state: { bank: structuredClone(before) } },
        session: { connectionMode: 'file' },
        operationScope: { capture: () => () => {} },
        localSnapshot: {
          state: () => null,
          save: async (bank) => {
            expected = bank;
            return true;
          },
        },
        prepareBankSnapshot: async () => {},
        sharedChecksObservedSequence: () => 7,
        sharedChecksHaveLocalWork: () => false,
        wholeMoney,
        normalizeBankFeed,
        uid: environment.createToken,
        todayISO: environment.today,
      });
      const command = vm.runInContext(manual.source + ';commitBankSnapshot', scope);
      assert.equal(await command(amount, options), true);
      const actual = createManualBankSnapshot(
        structuredClone(before),
        amount,
        7,
        options,
        environment
      );
      assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
    }
});

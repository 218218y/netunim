import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {root, check, describe} from './typecheck_contract_fixture.mjs';

for (const [name, file, before, after] of [
  ['historical feed money', 'shared/bank-feed.js', 'amount: readBankMoney(row.amount)', 'amount: "confirmed"'],
  ['raw Hapoalim money', 'netunim-kupa/bank-bridge/hapoalim-transaction-model.mjs', '    amount,', '    amount: String(amount),'],
  ['archive command keys', 'shared/bank-transaction-identity.js', 'return String(row.mergeKey || stableKey);', 'return false;'],
  ['history evidence', 'shared/bank-transaction-identity.js', 'current: true', 'current: "confirmed"'],
]) {
  test(`the actual ${name} contract rejects presentation text and wrong scalar types`, () => {
    const source = path.join(root, file), original = readFileSync(source, 'utf8');
    const changed = original.replace(before, after);
    assert.notEqual(changed, original, before);
    const diagnostics = check(new Map([[source, changed]]));
    assert.ok(diagnostics.some(item => item.file && [2322,2339,2345].includes(item.code)), describe(diagnostics));
  });
}

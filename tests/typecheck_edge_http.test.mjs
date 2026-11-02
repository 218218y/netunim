import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root, check, describe} from './typecheck_contract_fixture.mjs';

test('strict checking rejects broken receipt types inside the actual Edge implementations', () => {
  const folder = 'netunim-orders/supabase/functions/_shared/';
  const mutations = [
    ['http-input.js', 'return value;', "return 'unchecked';"],
    ['google-receipts.js', 'return {access_token, expires_in,', 'return {access_token:123, expires_in,'],
  ];
  const overrides = new Map();
  for (const [name, before, after] of mutations) {
    const file = path.join(root, folder, name), source = readFileSync(file, 'utf8');
    assert.ok(source.includes(before));
    overrides.set(file, source.replace(before, after));
  }
  const diagnostics = check(overrides);
  for (const file of overrides.keys()) assert.ok(diagnostics.some(item => item.file &&
    path.resolve(item.file.fileName) === file && item.code === 2322), describe(diagnostics));
});

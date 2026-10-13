import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { providerPolicyHashes } from './bank_provider_policy_fixture.mjs';
const model = fs.readFileSync(
  new URL('../netunim-kupa/bank-bridge/credit-diagnostic-model.mjs', import.meta.url),
  'utf8'
);
const logger = fs.readFileSync(
  new URL('../netunim-kupa/bank-bridge/credit-diagnostic-log.mjs', import.meta.url),
  'utf8'
);
const fixture = JSON.parse(
  fs.readFileSync(new URL('./fixtures/bank-artifact-policy.json', import.meta.url), 'utf8')
);
test('diagnostic sanitization, fingerprints, retention, rotation and append policies preserve the reviewed baseline', () => {
  assert.deepEqual(
    providerPolicyHashes([model, logger], Object.keys(fixture.policies)),
    fixture.policies
  );
});
test('diagnostic policy comparison rejects widened raw-key retention and changed log pruning', () => {
  for (const [source, before, after, name] of [
    [model, /\.slice\(0,\s*40\)/, '.slice(0,400)', 'safeKeys'],
    [logger, /now\s*-\s*stat.mtimeMs\s*>\s*retentionMs/, 'now-stat.mtimeMs>=retentionMs', 'prune'],
  ]) {
    const changed = source.replace(before, after);
    assert.notEqual(changed, source);
    assert.notEqual(
      providerPolicyHashes(
        [source === model ? changed : model, source === logger ? changed : logger],
        [name]
      )[name],
      fixture.policies[name]
    );
  }
});

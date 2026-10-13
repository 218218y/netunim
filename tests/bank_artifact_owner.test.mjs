import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { artifactFixture, gate } from './bank_artifact_fixture.mjs';

test('metadata reads retain historical defaults, unknown persisted fields and undefined patch deletion', async (t) => {
  const f = await artifactFixture(t);
  assert.deepEqual(await f.api.creditMeta.read(), { lastSyncAt: null, lastErrors: [] });
  assert.deepEqual(await f.api.bankMeta.read(), {
    lastScrapeAt: null,
    lastError: '',
    lastErrorAt: null,
    lastErrorCode: '',
    lastErrorStage: '',
    lastErrorHttpStatus: 0,
    lastWarning: '',
    lastWarningCode: '',
    lastWarningStage: '',
    lastWarningHttpStatus: 0,
    lastAvailableAccounts: [],
    lastAccountRole: '',
    browserPath: '',
    sessionUrl: '',
  });
  await fs.writeFile(
    f.names.META_FILE,
    JSON.stringify({ historicalField: { retained: true }, lastError: 'old' })
  );
  await f.api.bankMeta.write({ lastError: undefined, browserPath: 'fixture-browser' });
  assert.deepEqual(await f.api.bankMeta.read(), {
    historicalField: { retained: true },
    browserPath: 'fixture-browser',
  });
  await fs.writeFile(f.names.CREDIT_META_FILE, 'not JSON');
  assert.deepEqual(await f.api.creditMeta.read(), { lastSyncAt: null, lastErrors: [] });
});

test('metadata patches preserve special persisted JSON keys as own data fields', async (t) => {
  const f = await artifactFixture(t),
    historical = '{"__proto__":{"retained":true},"constructor":"legacy-field","lastError":"old"}';
  await fs.writeFile(f.names.META_FILE, historical);
  await f.api.bankMeta.write({ lastError: 'new' });
  const persisted = JSON.parse(await fs.readFile(f.names.META_FILE, 'utf8'));
  assert.equal(Object.hasOwn(persisted, '__proto__'), true);
  assert.deepEqual(persisted.__proto__, { retained: true });
  assert.equal(persisted.constructor, 'legacy-field');
});

test('diagnostic readers prefer current data and use the historical reader only when the current file is missing', async (t) => {
  const f = await artifactFixture(t);
  await fs.mkdir(f.diagnosticDirectory);
  assert.equal(await f.api.bankDiagnostic.read(), null);
  await fs.writeFile(
    f.names.LEGACY_BANK_CHEQUE_DIAGNOSTIC_FILE,
    JSON.stringify({ historical: true })
  );
  assert.deepEqual(await f.api.bankDiagnostic.read(), { historical: true });
  await f.api.bankDiagnostic.write({ current: true });
  assert.deepEqual(await f.api.bankDiagnostic.read(), { current: true });
  await fs.writeFile(f.names.BANK_DIAGNOSTIC_FILE, 'malformed');
  await assert.rejects(f.api.bankDiagnostic.read(), SyntaxError);
  await f.api.bankDiagnostic.clear();
  await assert.rejects(fs.access(f.names.LEGACY_BANK_CHEQUE_DIAGNOSTIC_FILE), { code: 'ENOENT' });
  assert.equal(await f.api.bankDiagnostic.read(), null);
  assert.equal(await f.api.creditData.read(), null);
  await f.api.creditData.write(null);
  assert.equal(await f.api.creditData.read(), null);
});

test('metadata readers and later patches wait for publication and preserve every accepted detached patch', async (t) => {
  const entered = gate(),
    held = gate();
  let promotions = 0;
  const files = {
    ...fs,
    rename: async (...args) => {
      if (++promotions === 1) {
        entered.resolve();
        await held.promise;
      }
      return fs.rename(...args);
    },
  };
  const f = await artifactFixture(t, { files });
  await fs.writeFile(
    f.names.META_FILE,
    JSON.stringify({ browserPath: 'retained-browser', custom: 'retained' })
  );
  const first = f.api.bankMeta.write({ sessionUrl: 'new-session' });
  await entered.promise;
  const patch = { lastAvailableAccounts: [{ accountId: 'accepted-account' }] },
    second = f.api.bankMeta.write(patch);
  patch.lastAvailableAccounts[0].accountId = 'late mutation';
  let readFinished = false,
    drained = false;
  const reading = f.api.bankMeta.read().then((value) => {
      readFinished = true;
      return value;
    }),
    draining = f.api.drain().then(() => {
      drained = true;
    });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(readFinished, false);
    assert.equal(drained, false);
    assert.deepEqual(JSON.parse(await fs.readFile(f.names.META_FILE, 'utf8')), {
      browserPath: 'retained-browser',
      custom: 'retained',
    });
  } finally {
    held.resolve();
  }
  await Promise.all([first, second, draining]);
  assert.deepEqual(await reading, {
    browserPath: 'retained-browser',
    custom: 'retained',
    sessionUrl: 'new-session',
    lastAvailableAccounts: [{ accountId: 'accepted-account' }],
  });
});

test('diagnostic input is detached at acceptance and clear cannot be undone by an older queued publication', async (t) => {
  const entered = gate(),
    held = gate();
  const files = {
    ...fs,
    rename: async (...args) => {
      entered.resolve();
      await held.promise;
      return fs.rename(...args);
    },
  };
  const f = await artifactFixture(t, { files }),
    input = { schemaVersion: 3, accounts: { business: { captured: 1 } } };
  const writing = f.api.bankDiagnostic.write(input);
  input.accounts.business.captured = 99;
  await entered.promise;
  const attempts=(await fs.readdir(f.diagnosticDirectory)).filter(name=>name.endsWith('.tmp'));
  assert.equal(attempts.length,1);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.diagnosticDirectory,attempts[0]),'utf8')).accounts.business.captured,1);
  const clearing = f.api.bankDiagnostic.clear();
  held.resolve();
  await Promise.all([writing, clearing]);
  assert.equal(await f.api.bankDiagnostic.read(), null);
  const pending = f.api.creditData.write({ schemaVersion: 1, profiles: [{ label: 'accepted' }] });
  await pending;
  assert.equal((await f.api.creditData.read()).profiles[0].label, 'accepted');
});

test('rejected file publication does not poison later jobs or remove unrelated operator files', async (t) => {
  let fail = true;
  const failure = new Error('fixture promotion failure'),
    files = {
      ...fs,
      rename: async (...args) => {
        if (fail) throw failure;
        return fs.rename(...args);
      },
    };
  const f = await artifactFixture(t, { files });
  await fs.writeFile(path.join(f.directory, 'operator-notes.txt'), 'retained');
  await assert.rejects(
    f.api.creditMeta.write({ lastSyncAt: 'failed' }),
    (error) => error === failure
  );
  fail = false;
  await f.api.creditMeta.write({ lastSyncAt: 'committed' });
  assert.equal((await f.api.creditMeta.read()).lastSyncAt, 'committed');
  assert.equal(await fs.readFile(path.join(f.directory, 'operator-notes.txt'), 'utf8'), 'retained');
  assert.deepEqual(
    (await fs.readdir(f.directory)).filter((name) => name.endsWith('.tmp')),
    []
  );
  await f.api.drain();
});

test('diagnostic permission failures cannot silently adopt a historical file', async (t) => {
  const error = Object.assign(new Error('fixture current access denied'), { code: 'EACCES' }),
    calls = [];
  const files = {
      ...fs,
      readFile: async (...args) => {
        calls.push(path.basename(String(args[0])));
        throw error;
      },
    },
    f = await artifactFixture(t, { files });
  await assert.rejects(f.api.bankDiagnostic.read(), (failure) => failure === error);
  assert.deepEqual(calls, ['bank-latest.json']);
  const fallback = await f.api.bankMeta.read();
  assert.equal(
    fallback.lastScrapeAt,
    null,
    'metadata retains its historical all-read-errors fallback'
  );
});

test('JSON serialization rejection preserves committed bytes and remains an asynchronous failure', async (t) => {
  const f = await artifactFixture(t);
  await f.api.creditData.write({ retained: true });
  const before = await fs.readFile(f.names.CREDIT_DATA_DIAGNOSTIC_FILE, 'utf8');
  const rejected = f.api.creditData.write({ unsupported: 1n });
  assert.ok(rejected instanceof Promise);
  await assert.rejects(rejected, TypeError);
  assert.equal(await fs.readFile(f.names.CREDIT_DATA_DIAGNOSTIC_FILE, 'utf8'), before);
  await f.api.creditData.write({ recovered: true });
  assert.deepEqual(await f.api.creditData.read(), { recovered: true });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { artifactFixture } from './bank_artifact_fixture.mjs';

test('rejected Bank metadata bytes preserve the last complete persisted status', async (t) => {
  const failure = Object.assign(new Error('fixture metadata disk failure'), { code: 'ENOSPC' });
  const files = {
    ...fs,
    writeFile: async (file, data, options) => {
      if (String(file).includes('status.json')) {
        await fs.writeFile(file, '{"partial":', options);
        throw failure;
      }
      return fs.writeFile(file, data, options);
    },
  };
  const f = await artifactFixture(t, { files }),
    before = JSON.stringify({
      browserPath: 'retained-browser',
      sessionUrl: 'retained-session',
      lastScrapeAt: 'retained-time',
    });
  await fs.writeFile(f.names.META_FILE, before);
  await assert.rejects(
    f.api.bankMeta.write({ lastError: 'new error' }),
    (error) => error === failure
  );
  assert.equal(
    await fs.readFile(f.names.META_FILE, 'utf8'),
    before,
    'failed status publication cannot truncate Last Known Good metadata'
  );
});

for (const [capability, file] of [
  ['bankDiagnostic', 'BANK_DIAGNOSTIC_FILE'],
  ['creditData', 'CREDIT_DATA_DIAGNOSTIC_FILE'],
])
  test(
    capability +
      ' publication failure removes its own temporary attempt and retains the old document',
    async (t) => {
      const failure = new Error('fixture promotion failed'),
        files = {
          ...fs,
          rename: async () => {
            throw failure;
          },
        },
        f = await artifactFixture(t, { files });
      await fs.mkdir(f.diagnosticDirectory);
      const before = JSON.stringify({ schemaVersion: 1, retained: true });
      await fs.writeFile(f.names[file], before);
      await assert.rejects(
        f.api[capability].write({ schemaVersion: 1, replacement: true }),
        (error) => error === failure
      );
      assert.equal(await fs.readFile(f.names[file], 'utf8'), before);
      assert.deepEqual(
        (await fs.readdir(f.diagnosticDirectory)).filter((name) => name.endsWith('.tmp')),
        [],
        'rejected artifact publication must release its owned temporary file'
      );
    }
  );

import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFixture } from './bank_file_fixture.mjs';

test('browser lookup is inert, prefers a valid persisted path and owns its cached selection', async () => {
  const f = browserFixture({ saved: ' saved ', visible: ['saved', 'chrome', 'edge'] });
  assert.deepEqual(f.calls, []);
  assert.equal(await f.find(), 'saved');
  const count = f.calls.length;
  assert.equal(await f.find(), 'saved');
  assert.equal(f.calls.length, count);
});

test('browser discovery preserves candidate priority, persisted hint publication and bounded where fallback', async () => {
  const f = browserFixture({ saved: 'missing', visible: ['chrome', 'edge'] });
  assert.equal(await f.find(), 'chrome');
  assert.equal(f.calls.at(-1)[1].browserPath, 'chrome');
  const fallback = browserFixture({
    where: async (name) => {
      if (name === 'chrome.exe') throw new Error('missing');
      return '\r\n edge-from-where \r\nignored';
    },
  });
  assert.equal(await fallback.find(), 'edge-from-where');
  assert.deepEqual(
    fallback.calls.filter((call) => call[0] === 'where').map((call) => call[1]),
    ['chrome.exe', 'msedge.exe']
  );
});

test('non-Windows and absent browsers retain failure taxonomy without reading credentials', async () => {
  const linux = browserFixture({ osName: 'linux' });
  await assert.rejects(linux.find(), { code: 'WINDOWS_REQUIRED' });
  assert.deepEqual(linux.calls, []);
  const missing = browserFixture();
  await assert.rejects(missing.find(), { code: 'BROWSER_NOT_FOUND' });
});

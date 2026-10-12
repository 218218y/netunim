import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewTextCache} from '../netunim-orders/document-bridge/preview-text-cache.mjs';
import {serverFixture} from './document_preview_cache_server_fixture.mjs';

test('production server cannot republish an invalidated late fill over a replacement', async t => {
  const f = await serverFixture(t, {createPreviewTextCache});
  const old = f.read(f.row, f.stat); await f.firstStarted.promise;
  await f.invalidate(f.fullPath); await f.replace('new');
  assert.equal((await f.read(f.row, f.stat)).text, 'new');
  f.firstRelease.resolve(); assert.equal((await old).text, 'old');
  assert.equal((await f.read(f.row, f.stat)).text, 'new'); assert.equal(f.reads(), 2);
});

test('production server shares simultaneous native text extraction for one fingerprint', async t => {
  const f = await serverFixture(t, {createPreviewTextCache});
  const first = f.read(f.row, f.stat), second = f.read(f.row, f.stat);
  await f.firstStarted.promise; f.firstRelease.resolve();
  const results = await Promise.all([first, second]);
  assert.equal(results[0].text, 'old'); assert.equal(results[1].text, 'old'); assert.equal(f.reads(), 1);
});

test('production server reloads changed metadata instead of reusing same-path content', async t => {
  const f = await serverFixture(t, {createPreviewTextCache});
  const first = f.read(f.row, f.stat); await f.firstStarted.promise; f.firstRelease.resolve(); await first;
  await f.replace('new content');
  const changedStat = {...f.stat, size: 11, mtimeMs: f.stat.mtimeMs + 1};
  assert.equal((await f.read(f.row, changedStat)).text, 'new content'); assert.equal(f.reads(), 2);
});

test('production match responses retain fresh content after an older request completes', async t => {
  const f = await serverFixture(t, {createPreviewTextCache});
  const old = f.matches('opaque'); await f.firstStarted.promise;
  await f.invalidate(f.fullPath); await f.replace('new new'); f.row.query = 'new';
  const current = await f.matches('opaque');
  assert.equal(current.count, 2); assert.equal(current.source, 'file'); assert.equal(current.query, 'new');
  assert.equal(current.bridgeVersion, 38); assert.equal(current.truncated, false);
  f.firstRelease.resolve(); assert.equal((await old).count, 1, 'started caller settles its captured query');
  assert.equal((await f.matches('opaque')).count, 2); assert.equal(f.reads(), 2);
});

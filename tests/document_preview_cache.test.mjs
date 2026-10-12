import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreviewTextCache} from '../netunim-orders/document-bridge/preview-text-cache.mjs';
import {deferred} from './document_preview_cache_server_fixture.mjs';

const data = text => ({text, source: 'file', truncated: false});
function fixture(options = {}) {
  let now = 0;
  const cache = createPreviewTextCache({clock: () => now, ttlMs: 100, maxEntries: 2, ...options});
  return {...cache, advance: milliseconds => { now += milliseconds; }};
}

test('100 concurrent reads of one path/version share one extraction and cache its result', async () => {
  const cache = fixture(), pending = deferred(); let calls = 0;
  const load = () => { calls++; return pending.promise; };
  const readers = Array.from({length: 100}, () => cache.read('C:\\files\\report.txt', '1:2', load));
  await Promise.resolve(); assert.equal(calls, 1);
  const content = data('hello'); pending.resolve(content);
  for (const result of await Promise.all(readers)) assert.equal(result, content);
  assert.equal(await cache.read('c:\\FILES\\REPORT.TXT', '1:2', load), content);
  assert.equal(calls, 1);
});

test('invalidation prevents an old fill from replacing new content with the same fingerprint', async () => {
  const cache = fixture(), old = deferred();
  const oldRead = cache.read('a', 'unchanged-file', () => old.promise);
  cache.invalidate('A'); const current = data('current');
  assert.equal(await cache.read('a', 'unchanged-file', async () => current), current);
  old.resolve(data('old')); assert.equal((await oldRead).text, 'old', 'the old caller owns its already-started result');
  assert.equal(await cache.read('a', 'unchanged-file', async () => { throw new Error('must hit new cache'); }), current);
});

test('invalidation during extraction leaves the result uncached without silently retrying', async () => {
  const cache = fixture(); let calls = 0;
  const load = async () => { calls++; cache.invalidate('a'); return data('updated PDF index'); };
  assert.equal((await cache.read('a', 'f', load)).text, 'updated PDF index');
  assert.equal((await cache.read('a', 'f', load)).text, 'updated PDF index');
  assert.equal(calls, 2, 'each explicit request loads once; self-invalidation cannot reacquire cache publication');
});

test('a different fingerprint retires the pending owner even if its response arrives last', async () => {
  const cache = fixture(), older = deferred();
  const first = cache.read('a', 'v1', () => older.promise), current = data('v2');
  await cache.read('a', 'v2', async () => current);
  older.resolve(data('v1')); await first;
  assert.equal(await cache.read('a', 'v2', async () => { throw new Error('lost new version'); }), current);
});

test('an old rejection cannot delete a replacement owner', async () => {
  const cache = fixture(), older = deferred();
  const first = cache.read('a', 'v1', () => older.promise), rejected = assert.rejects(first, /old failed/), current = data('v2');
  await cache.read('a', 'v2', async () => current);
  older.reject(new Error('old failed')); await rejected;
  assert.equal(await cache.read('a', 'v2', async () => { throw new Error('replacement was deleted'); }), current);
});

test('joined failures retain the error and permit a new explicit request', async () => {
  const cache = fixture(), pending = deferred(), error = Object.assign(new Error('read failed'), {code: 'EIO'}); let calls = 0;
  const load = () => { calls++; return pending.promise; };
  const first = cache.read('a', 'v1', load), second = cache.read('a', 'v1', load);
  const firstError = assert.rejects(first, error), secondError = assert.rejects(second, error);
  pending.reject(error); await Promise.all([firstError, secondError]); assert.equal(calls, 1);
  assert.equal((await cache.read('a', 'v1', async () => data('recovered'))).text, 'recovered');
});

test('unavailable results are not sticky cached failures', async () => {
  const cache = fixture(); let calls = 0;
  const load = async () => { calls++; return null; };
  assert.equal(await cache.read('a', 'f', load), null); assert.equal(await cache.read('a', 'f', load), null);
  assert.equal(calls, 2);
});

test('LRU capacity retains touched entries and reloads an evicted one', async () => {
  const cache = fixture(), a = data('a'), b = data('b'), c = data('c');
  await cache.read('a', 'f', async () => a); await cache.read('b', 'f', async () => b);
  assert.equal(await cache.read('a', 'f', async () => { throw new Error('a should hit'); }), a);
  await cache.read('c', 'f', async () => c);
  assert.equal(await cache.read('a', 'f', async () => { throw new Error('touch was ignored'); }), a);
  let loaded = false;
  assert.equal(await cache.read('b', 'f', async () => { loaded = true; return b; }), b); assert.equal(loaded, true);
});

test('capacity eviction also fences a late pending fill', async () => {
  const cache = fixture(), pending = deferred(), a = data('a');
  const old = cache.read('a', 'f', () => pending.promise);
  await cache.read('b', 'f', async () => data('b')); await cache.read('c', 'f', async () => data('c'));
  pending.resolve(a); await old;
  let loaded = false;
  await cache.read('a', 'f', async () => { loaded = true; return a; }); assert.equal(loaded, true);
});

test('a newly completed result becomes recent without reviving an evicted owner', async () => {
  const cache = fixture(), pending = deferred(); const first = cache.read('a', 'f', () => pending.promise);
  await cache.read('b', 'f', async () => data('b')); pending.resolve(data('a')); await first;
  await cache.read('c', 'f', async () => data('c'));
  assert.equal((await cache.read('a', 'f', async () => { throw new Error('completed entry was evicted'); })).text, 'a');
  let loaded = false;
  await cache.read('b', 'f', async () => { loaded = true; return data('b'); }); assert.equal(loaded, true);
});

test('TTL begins on completion, refreshes on hits, and preserves the existing exact-boundary rule', async () => {
  const cache = fixture(), pending = deferred(); const read = cache.read('a', 'f', () => pending.promise);
  cache.advance(1000); pending.resolve(data('a')); await read;
  cache.advance(100);
  assert.equal((await cache.read('a', 'f', async () => { throw new Error('exact boundary still hits'); })).text, 'a');
  cache.advance(101); let loaded = false;
  await cache.read('a', 'f', async () => { loaded = true; return data('fresh'); }); assert.equal(loaded, true);
});

test('PDF source, truncation and normalized form geometry survive a shared fill unchanged', async () => {
  const cache = fixture();
  const content = {text: 'form', source: 'pdfjs-acroform', truncated: true, formFields: [{pageNumber: 2, annotationIndex: 3, fieldKey: 'field', fieldName: 'name', fieldType: 'Tx', rect: [1, 2, 3, 4], values: ['form'], multiLine: false}]};
  assert.equal(await cache.read('a.pdf', '1:2:pdf-search-2:geometry-1', async () => content), content);
  assert.equal(await cache.read('A.PDF', '1:2:pdf-search-2:geometry-1', async () => { throw new Error('cache miss'); }), content);
  let loaded = false;
  await cache.read('a.pdf', '1:2:pdf-search-2:geometry-2', async () => { loaded = true; return content; }); assert.equal(loaded, true);
});

test('terminal disposal allows started callers to settle but prevents caching and new loads', async () => {
  const cache = fixture(), pending = deferred(); const old = cache.read('a', 'f', () => pending.promise);
  await Promise.resolve(); cache.dispose(); cache.dispose(); cache.invalidate('a');
  pending.resolve(data('completed')); assert.equal((await old).text, 'completed');
  await assert.rejects(cache.read('a', 'f', async () => { throw new Error('must not start'); }), /document_preview_cache_disposed/);
});

test('disposal before the loader enters prevents new filesystem/provider work', async () => {
  const cache = fixture(); let started = false;
  const queued = cache.read('a', 'f', async () => { started = true; return data('never'); });
  cache.dispose();
  await assert.rejects(queued, /document_preview_cache_disposed/); assert.equal(started, false);
});

test('100 invalidation and replacement cycles never admit a retired completion', async () => {
  const cache = fixture();
  for (let cycle = 0; cycle < 100; cycle++) {
    const pending = deferred(), old = cache.read('a', 'f', () => pending.promise);
    cache.invalidate('a'); const current = data(`current-${cycle}`);
    await cache.read('a', 'f', async () => current); pending.resolve(data(`old-${cycle}`)); await old;
    assert.equal(await cache.read('a', 'f', async () => { throw new Error('replacement lost'); }), current);
  }
});

test('invalid cache options and requests fail before loader entry', () => {
  for (const options of [{clock: null, ttlMs: 1, maxEntries: 1}, {clock: Date.now, ttlMs: -1, maxEntries: 1}, {clock: Date.now, ttlMs: Infinity, maxEntries: 1}, {clock: Date.now, ttlMs: 1, maxEntries: 0}, {clock: Date.now, ttlMs: 1, maxEntries: 1.5}]) {
    assert.throws(() => createPreviewTextCache(options), /document_preview_cache_options_required/);
  }
  const cache = fixture();
  assert.throws(() => cache.read('', 'f', async () => data('never')), /document_preview_cache_request_required/);
  assert.throws(() => cache.read('a', '', async () => data('never')), /document_preview_cache_request_required/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash, webcrypto} from 'node:crypto';

function fixture(app) {
  const asset = 'https://fixture.test/assets/vendor/pdfjs/build/pdf.mjs', bytes = 'verified vendor bytes';
  const digest = createHash('sha256').update(bytes).digest('hex');
  let source = fs.readFileSync(new URL(`../netunim-${app}/site/service-worker.js`, import.meta.url), 'utf8');
  const hashes = `const VENDOR_HASHES=${JSON.stringify({'./assets/vendor/pdfjs/build/pdf.mjs': digest})};`;
  source = source.includes('const VENDOR_HASHES=') ? source.replace(/const VENDOR_HASHES=\{[\s\S]*?\};/, hashes) : hashes+'\n'+source;
  const release = source.match(/const CACHE='([^']+)'/)[1], handlers = {}, entries = new Map(), requests = [], notices = [];
  let online = true, body = bytes, interrupted = false;
  const cache = {match: async key => entries.get(typeof key === 'string' ? key : key.url)?.clone(),
    put: async (key, response) => entries.set(typeof key === 'string' ? key : key.url, response.clone()),
    delete: async key => entries.delete(typeof key === 'string' ? key : key.url)};
  vm.runInNewContext(source, {URL, Promise, Error, Response, Headers, Uint8Array, crypto: webcrypto, console,
    self: {location: {origin: 'https://fixture.test', href: 'https://fixture.test/service-worker.js'},
      clients: {matchAll: async () => [{postMessage: value => notices.push(value)}]}, addEventListener: (name, fn) => {handlers[name] = fn}},
    caches: {open: async () => cache},
    fetch: async url => {
      requests.push(url);
      if (!online) throw Error('offline');
      if (interrupted) return new Response(new ReadableStream({start(controller) {controller.error(Error('interrupted download'))}}), {headers: {'X-Netunim-Release': 'new-release'}});
      return new Response(body, {headers: {'X-Netunim-Release': 'new-release'}});
    },
  });
  async function get(url = asset) {
    let result; const work = [];
    handlers.fetch({request: {url, method: 'GET', mode: 'cors'}, respondWith: promise => {result = promise}, waitUntil: promise => work.push(promise)});
    try {return await result} finally {await Promise.all(work)}
  }
  return {asset, bytes, digest, entries, requests, notices, release, get,
    offline: () => {online = false}, changed: () => {body = 'incompatible vendor'}, interrupted: () => {interrupted = true}};
}

for (const app of ['orders', 'kupa']) {
  test(`${app}: identical uncached vendor survives a different deployment release header`, async () => {
    const f = fixture(app), response = await f.get();
    assert.equal(await response.text(), f.bytes);
    assert.equal(response.headers.get('X-Netunim-Release'), f.release);
    assert.equal(new URL(f.requests[0]).searchParams.get('__netunim_vendor'), f.digest);
    f.offline(); assert.equal(await (await f.get()).text(), f.bytes);
    assert.equal(f.requests.length, 1, 'Verified vendor cache hit must not need the next deployment');
  });
  test(`${app}: changed, unknown and interrupted vendors never enter a release cache`, async () => {
    const changed = fixture(app); changed.changed();
    await assert.rejects(changed.get(), /vendor_integrity_mismatch/);
    assert.equal(changed.entries.size, 0); assert.ok(changed.notices.length);
    const unknown = fixture(app);
    await assert.rejects(unknown.get(unknown.asset.replace('pdf.mjs', 'unknown.mjs')), /vendor_not_in_release/);
    assert.equal(unknown.requests.length, 0);
    const interrupted = fixture(app); interrupted.interrupted();
    await assert.rejects(interrupted.get(), /interrupted download/);
    assert.equal(interrupted.entries.size, 0);
  });
  test(`${app}: cached compatible bytes survive changed network bytes and corruption is revalidated`, async () => {
    const f = fixture(app); await f.get(); f.changed();
    assert.equal(await (await f.get()).text(), f.bytes);
    f.entries.set(f.asset, new Response('poisoned cache', {headers: {'X-Netunim-Release': f.release}}));
    await assert.rejects(f.get(), /vendor_integrity_mismatch/);
    assert.equal(f.entries.size, 0);
  });
}

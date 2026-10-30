import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for (const app of ['orders', 'kupa']) test(`${app}: redirected HTML is cached as a usable canonical offline document`, async () => {
  const source = fs.readFileSync(new URL(`../netunim-${app}/site/service-worker.js`, import.meta.url), 'utf8')
    .replace(/const SHELL=\[[\s\S]*?\];/, "const SHELL=['./','./index.html','./reset-local.html'];");
  const release = source.match(/const CACHE='([^']+)'/)[1], handlers = {}, entries = new Map();
  const urlOf = key => new URL(typeof key === 'string' ? key : key.url, 'https://fixture.test/').href;
  let offline = false;
  vm.runInNewContext(source, {URL, Promise, Error, Response, console,
    self: {location: {origin: 'https://fixture.test', href: 'https://fixture.test/service-worker.js'},
      addEventListener: (name, fn) => {handlers[name] = fn}, skipWaiting: async () => {}},
    caches: {open: async () => ({put: async (key, value) => entries.set(urlOf(key), value.clone()),
      match: async key => entries.get(urlOf(key))?.clone()})},
    fetch: async target => {
      if (offline) throw Error('no server');
      const reset = new URL(target).pathname === '/reset-local.html';
      const response = new Response(reset ? 'reset-page' : 'index-page', {headers: {'X-Netunim-Release': release}});
      Object.defineProperty(response, 'redirected', {value: true});
      return response;
    },
  });
  let installing;
  handlers.install({waitUntil: promise => {installing = promise}});
  await installing;
  assert.equal(entries.get('https://fixture.test/reset-local.html').redirected, false);
  offline = true;
  for (const [pathname, expected] of [['/reset-local?peer=1', 'reset-page'], ['/reset-local.html?peer=1', 'reset-page'], ['/index', 'index-page'], ['/', 'index-page']]) {
    let result;
    const work = [];
    handlers.fetch({request: {url: 'https://fixture.test'+pathname, method: 'GET', mode: 'navigate'},
      respondWith: promise => {result = promise}, waitUntil: promise => work.push(promise)});
    const response = await result;
    assert.equal(await response.text(), expected, pathname);
    assert.equal(response.headers.get('X-Netunim-Release'), release);
    await Promise.all(work);
  }
});

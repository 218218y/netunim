import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for (const app of ['orders', 'kupa']) {
  test(`${app}: failed install waits for in-flight writes and deletes incomplete cache`, async () => {
    const source = fs.readFileSync(new URL(`../netunim-${app}/site/service-worker.js`, import.meta.url), 'utf8')
      .replace(/const SHELL=\[[\s\S]*?\];/, "const SHELL=['./ok.js','./bad.js','./slow.js'];");
    const release = source.match(/const CACHE='([^']+)'/)[1], handlers = {}, entries = new Map();
    let releaseWrite, entered = false, deleted = false, skipped = false;
    const pending = new Promise(resolve => {releaseWrite = resolve});
    const context = {URL, Promise, Error, console,
      self: {location: {href: 'https://fixture.test/service-worker.js'}, addEventListener: (name, fn) => {handlers[name] = fn}, skipWaiting: async () => {skipped = true}},
      caches: {open: async () => ({put: async (name, value) => {
        if (name === './slow.js') {entered = true; await pending}
        entries.set(name, value);
      }}), delete: async () => {deleted = true; entries.clear()}},
      fetch: async url => ({ok: true, headers: {get: () => url.includes('bad.js') ? 'wrong-release' : release}}),
    };
    vm.runInNewContext(source, context);
    let installing;
    handlers.install({waitUntil: promise => {installing = promise}});
    const rejected = assert.rejects(installing, /shell_release_mismatch/);
    while (!entered) await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(deleted, false);
    releaseWrite();
    await rejected;
    assert.equal(deleted, true);
    assert.equal(entries.size, 0);
    assert.equal(skipped, false);
  });
  test(`${app}: verified hashed chunks are served without network revalidation`, async () => {
    const asset = './assets/build/deferred-HASH.js';
    const source = fs.readFileSync(new URL(`../netunim-${app}/site/service-worker.js`, import.meta.url), 'utf8')
      .replace(/const SHELL=\[[\s\S]*?\];/, `const SHELL=${JSON.stringify([asset])};`);
    const release = source.match(/const CACHE='([^']+)'/)[1], handlers = {};
    let network = 0;
    const cached = new Response('old-release-module', {headers: {'X-Netunim-Release': release}});
    vm.runInNewContext(source, {URL, Promise, Error, console,
      self: {location: {origin: 'https://fixture.test', href: 'https://fixture.test/service-worker.js'}, addEventListener: (name, fn) => {handlers[name] = fn}},
      caches: {open: async () => ({match: async () => cached.clone()})},
      fetch: async () => {network++; throw Error('New deployment deleted old assets')},
    });
    let response;
    const waits = [];
    handlers.fetch({request: {method: 'GET', mode: 'cors', url: new URL(asset, 'https://fixture.test/').href},
      respondWith: result => {response = result}, waitUntil: result => waits.push(result)});
    assert.equal(await (await response).text(), 'old-release-module');
    await Promise.all(waits);
    assert.equal(network, 0);
  });
}

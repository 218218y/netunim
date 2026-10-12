import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinanceBrowserEffects} from '../netunim-orders/site/assets/js/platform/finance-effects.js';

function fixture(failure=null) {
  let next = 0, online = true;
  const urls = new Map(), nodes = new Set(), jobs = new Map(), revoked = [], anchors = [], copies = [];
  const error = Error('injected ' + failure);
  const environment = {
    navigator:{get onLine() { return online; }, clipboard:{writeText:async text => copies.push(text)}}, Blob,
    URL:{createObjectURL:blob => { const url = 'blob:' + (++next); urls.set(url, blob); return url; }, revokeObjectURL:url => { urls.delete(url); revoked.push(url); }},
    document:{
      createElement() {
        if (failure === 'create') throw error;
        const anchor = {remove:() => nodes.delete(anchor), click:() => { if (failure === 'click') throw error; }};
        anchors.push(anchor); return anchor;
      },
      body:{appendChild(anchor) { if (failure === 'append') throw error; nodes.add(anchor); }},
    },
  };
  const effects = createFinanceBrowserEffects({environment, timers:{
    setTimeout(run, delay) { if (failure === 'timer') throw error; const id = ++next; jobs.set(id, {run, delay}); return id; },
    clearTimeout:id => jobs.delete(id),
  }});
  const fire = () => { const [id, job] = jobs.entries().next().value; jobs.delete(id); job.run(); };
  return {effects, environment, urls, nodes, jobs, revoked, anchors, copies, error, fire, offline:() => { online = false; }};
}

test('JSON downloads retain their wire text, MIME, filename rules and cleanup delay', async () => {
  const f = fixture();
  assert.equal(f.urls.size, 0); assert.equal(f.jobs.size, 0);
  f.effects.saveJson('safe-name.json', {version:1}, 'fallback.json');
  const blob = [...f.urls.values()][0];
  assert.equal(await blob.text(), '{\n  "version": 1\n}\n');
  assert.equal(blob.type, 'application/json;charset=utf-8');
  assert.equal(f.anchors[0].download, 'safe-name.json');
  assert.equal([...f.jobs.values()][0].delay, 1000);
  const delivered = [...f.jobs.values()][0].run;
  f.fire(); delivered();
  assert.equal(f.urls.size, 0); assert.equal(f.nodes.size, 0);
  assert.equal(f.revoked.length, 1);
  f.effects.saveJson('../unsafe.json', null, 'fallback.json');
  assert.equal(f.anchors[1].download, 'fallback.json');
  assert.equal(await [...f.urls.values()][0].text(), '{}\n');
  f.effects.dispose();
});

for (const failure of ['create','append','click','timer']) {
  test(`${failure} failure cleans every allocated download resource and preserves the original error`, () => {
    const f = fixture(failure);
    assert.throws(() => f.effects.saveJson('fixture.json', {}, 'fallback.json'), error => error === f.error);
    assert.equal(f.urls.size, 0); assert.equal(f.nodes.size, 0); assert.equal(f.jobs.size, 0);
    assert.equal(f.revoked.length, 1);
    f.effects.dispose(); assert.equal(f.revoked.length, 1);
  });
}

test('dispose releases multiple downloads exactly once and fences retained cleanup callbacks', () => {
  const f = fixture();
  for (let n = 0; n < 4; n++) f.effects.saveJson('fixture.json', {n}, 'fallback.json');
  const callbacks = [...f.jobs.values()].map(job => job.run);
  assert.equal(f.effects.dispose(), true); assert.equal(f.effects.dispose(), false);
  for (const run of callbacks) run();
  assert.equal(f.urls.size, 0); assert.equal(f.nodes.size, 0); assert.equal(f.jobs.size, 0);
  assert.equal(f.revoked.length, 4);
  assert.throws(() => f.effects.saveJson('fixture.json', {}, 'fallback.json'), /effects_disposed/);
  assert.equal(f.effects.isOnline(), false);
});

test('clipboard and connectivity follow their explicit browser ports', async () => {
  const f = fixture();
  assert.equal(f.effects.isOnline(), true); f.offline(); assert.equal(f.effects.isOnline(), false);
  await f.effects.writeText('safe diagnostic'); assert.deepEqual(f.copies, ['safe diagnostic']);
  delete f.environment.navigator.clipboard;
  await assert.rejects(f.effects.writeText('blocked'), /הדפדפן אינו מאפשר העתקה מאובטחת ללוח/);
  f.effects.dispose(); await assert.rejects(f.effects.writeText('blocked'), /effects_disposed/);
});

test('disposal retains an operation delay already started, while new delays are blocked', async () => {
  const f = fixture(); let completed = false;
  const waiting = f.effects.delay(25).then(() => { completed = true; });
  f.effects.dispose(); await Promise.resolve();
  assert.equal(completed, false); assert.equal(f.jobs.size, 1);
  assert.throws(() => f.effects.delay(25), /effects_disposed/);
  f.fire(); await waiting;
  assert.equal(completed, true); assert.equal(f.jobs.size, 0);
});

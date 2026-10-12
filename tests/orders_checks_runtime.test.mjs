import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncChecks} from '../netunim-orders/site/assets/js/sync/checks.js';

const noop = () => {};
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }
function fixture() {
  const held = gate(), entered = gate(), checksSession = {}, events = [];
  const model = {state:{checks:[]}};
  const sharedChecksV2 = {
    requested:true, primaryReady:true, hasLocalWork:false,
    async sync() { events.push('sync'); entered.resolve(); await held.promise; return true; },
    async cloudState() { return {seq:0, base:{revision:1, ackSeq:0, owner:'A', epoch:'E', state:{checks:[], bankEvents:[]}}, pending:false, flight:null, control:null}; },
  };
  const api = createSyncChecks({model, checksSession, sharedChecksV2, tab:{primaryTab:true},
    isOnline:() => true, loadSession:() => ({user:{id:'A'}}), toast:noop,
    setCloud:() => events.push('status'), recomputeKupaNetFromCache:() => events.push('readout'),
    renderKupaDependentView:() => events.push('render'), refreshCloudTimestamp:noop});
  return {api, checksSession, held, entered, events};
}

test('Checks owns its pending flights without placing promises in state', async () => {
  Object.defineProperty(globalThis, 'navigator', {value:{onLine:true}, configurable:true});
  const f = fixture(), pull = f.api.syncSharedChecksFromCloud({quiet:true});
  await f.entered.promise;
  const save = f.api.saveSharedChecksToCloud();
  const keys = Object.keys(f.checksSession);
  f.held.resolve();
  assert.deepEqual(await Promise.all([pull, save]), [true, true]);
  assert.equal(keys.includes('checksPullPromise'), false);
  assert.equal(keys.includes('checksSavePromise'), false);
  assert.equal(f.checksSession.checksCloudBusy, false);
});

test('Checks drain waits for both an active pull and a reserved save', async () => {
  const f = fixture(), pull = f.api.syncSharedChecksFromCloud({quiet:true});
  await f.entered.promise;
  const save = f.api.saveSharedChecksToCloud();
  assert.equal(f.api.runtime.isSaving(), true);
  let drained = false;
  const drain = f.api.runtime.drain().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  f.held.resolve(); await Promise.all([pull, save, drain]);
  assert.equal(f.events.filter(x => x === 'sync').length, 2);
  assert.equal(f.api.runtime.isPending(), false);
});

test('Checks disposal drains durable work and fences queued work and late presentation', async () => {
  const f = fixture(), pull = f.api.syncSharedChecksFromCloud();
  await f.entered.promise;
  const save = f.api.saveSharedChecksToCloud();
  assert.equal(f.api.runtime.dispose(), true);
  assert.equal(f.api.runtime.dispose(), false);
  const events = [...f.events];
  assert.equal(await f.api.syncSharedChecksFromCloud(), false);
  assert.equal(await f.api.saveSharedChecksToCloud(), false);
  f.held.resolve();
  assert.deepEqual(await Promise.all([pull, save]), [false, false]);
  await f.api.runtime.drain();
  assert.deepEqual(f.events, events);
  assert.equal(f.checksSession.checksCloudBusy, false);
});

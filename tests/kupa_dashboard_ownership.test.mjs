import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsDashboardController} from '../netunim-kupa/site/assets/js/domains/dashboard/controller.js';
import {createAuthenticatedAccountScope} from '../shared/authenticated-account-scope.js';
import {ordersFinanceSummaryData} from '../shared/orders-finance.js';

function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }
function fixture(t) {
  Object.defineProperty(globalThis, 'navigator', {value:{onLine:true}, configurable:true});
  const session = {supaSession:{user:{id:'A'}}, connectionMode:'supabase', backendReady:true};
  const scope = createAuthenticatedAccountScope({loadSession:() => session.supaSession});
  const held = gate(), entered = gate(), calls = [], publications = [];
  let time = 100_000, online = true;
  const row = owner => ({revision:owner === 'A' ? 1 : 2, state:{customerDebts:[{id:owner, amount:owner === 'A' ? 100 : 200}], suppliers:[], transactions:[]}});
  const readMeta = async () => { const owner = scope.current().owner; calls.push(['meta', owner]); return {revision:owner === 'A' ? 1 : 2}; };
  const readDocument = async () => {
    const owner = scope.current().owner; calls.push(['row', owner]);
    if (owner === 'A') { entered.resolve(); await held.promise; }
    return row(owner);
  };
  const api = createDomainsDashboardController({
    access:{current:() => ({account:scope.current(), readable:session.connectionMode === 'supabase' && session.backendReady, online}), subscribe:scope.subscribe},
    remote:{readMeta, readDocument}, project:ordersFinanceSummaryData, onChange:() => publications.push('change'),
    onError:error => assert.fail(error), clock:() => time,
  });
  api.runtime?.start();
  t.after(() => { held.resolve(); api.runtime?.dispose(); });
  const replace = owner => { session.supaSession = owner ? {user:{id:owner}} : null; scope.replace(session.supaSession); };
  return {api, session, scope, held, entered, calls, publications, replace, remote:{readMeta, readDocument},
    advance:amount => { time += amount; }, offline:() => { online = false; }};
}

test('Dashboard cannot publish an old Orders response into a new login for the same account', async t => {
  const f = fixture(t), reading = f.api.refreshOrdersFinanceSummary({force:true});
  await f.entered.promise;
  f.replace(null); f.replace('A'); f.held.resolve();
  assert.equal(await reading, false);
  assert.equal(f.api.summary(), null);
  assert.deepEqual(f.publications, []);
});

test('Dashboard joins same-login requests and drains every retained read across disposal', async t => {
  const f = fixture(t), first = f.api.refreshOrdersFinanceSummary({force:true});
  const joined = f.api.refreshOrdersFinanceSummary({force:true});
  assert.equal(first, joined);
  await f.entered.promise;
  assert.equal(f.api.runtime.isPending(), true);
  assert.equal(Object.hasOwn(f.session, 'ordersFinanceReadPromise'), false);
  assert.equal(f.api.runtime.dispose(), true); assert.equal(f.api.runtime.dispose(), false);
  let drained = false;
  const drain = f.api.runtime.drain().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  assert.equal(await f.api.refreshOrdersFinanceSummary({force:true}), false);
  f.held.resolve(); await drain;
  assert.equal(await first, false);
  assert.deepEqual(f.publications, []);
  assert.equal(f.api.runtime.isPending(), false);
  assert.equal(f.api.runtime.start(), false);
});

test('Dashboard keeps the ten-second cooldown, no-op projection and attributed offline cache', async t => {
  const f = fixture(t); f.held.resolve();
  assert.equal(await f.api.refreshOrdersFinanceSummary(), true);
  assert.equal(await f.api.refreshOrdersFinanceSummary(), false);
  assert.equal(f.calls.length, 2);
  f.advance(10_000);
  assert.equal(await f.api.refreshOrdersFinanceSummary(), false);
  assert.equal(f.calls.filter(([kind]) => kind === 'row').length, 1);
  f.offline();
  assert.equal(await f.api.refreshOrdersFinanceSummary({force:true}), false);
  const summary = f.api.summary();
  assert.equal(summary.customerOpen, 100);
  assert.equal(Object.isFrozen(summary), true);
  assert.throws(() => { summary.customerOpen = 300; }, TypeError);
});

test('Dashboard token refresh keeps the same-login flight and cached attribution', async t => {
  const f = fixture(t), reading = f.api.refreshOrdersFinanceSummary({force:true});
  await f.entered.promise;
  f.scope.replace(f.session.supaSession, {refresh:true});
  assert.equal(f.api.refreshOrdersFinanceSummary({force:true}), reading);
  f.held.resolve();
  assert.equal(await reading, true);
  assert.equal(f.api.summary().customerOpen, 100);
  assert.deepEqual(f.publications, ['change']);
});

test('Dashboard stopping/restarting fences the former read in a new runtime generation', async t => {
  const f = fixture(t), reading = f.api.refreshOrdersFinanceSummary({force:true});
  await f.entered.promise;
  f.scope.replace(f.session.supaSession, {refresh:true});
  assert.equal(f.api.runtime.stop(), true); assert.equal(f.api.runtime.stop(), false);
  assert.equal(f.api.runtime.start(), true); assert.equal(f.api.runtime.start(), false);
  const restarted = f.api.refreshOrdersFinanceSummary({force:true});
  assert.notEqual(reading, restarted);
  f.held.resolve();
  assert.deepEqual(await Promise.all([reading, restarted]), [false, true]);
  assert.equal(f.api.summary().customerOpen, 100);
});

test('Dashboard starts the new account read without joining the old account flight', async t => {
  const f = fixture(t), old = f.api.refreshOrdersFinanceSummary({force:true});
  await f.entered.promise;
  f.replace('B');
  const current = f.api.refreshOrdersFinanceSummary({force:true});
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  const calls = [...f.calls];
  f.held.resolve();
  const results = await Promise.all([old, current]);
  assert.equal(calls.some(([kind, owner]) => kind === 'meta' && owner === 'B'), true);
  assert.deepEqual(results, [false, true]);
  assert.equal(f.api.summary().customerOpen, 200);
});

test('Dashboard clears cached data on logout and does not expose it to an absent account', async t => {
  const f = fixture(t); f.held.resolve();
  assert.equal(await f.api.refreshOrdersFinanceSummary({force:true}), true);
  assert.equal(f.api.summary().customerOpen, 100);
  f.replace(null);
  assert.equal(f.api.summary(), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createOrdersFinanceCapability} from '../netunim-orders/site/assets/js/composition/finance.js';
import {composeActionRegistry} from '../shared/action-registry.js';
import {createFinanceStatusView} from '../netunim-orders/site/assets/js/domains/finance/status-view.js';

const noop = () => {};
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }
function fixture(t) {
  let disposed = 0, network = 0, revision = 0, timer = 0;
  const jobs = new Map(), preferences = new Map();
  const session = {}, model = {state:{checks:[]}}, ui = {currentView:'supplier'};
  const unexpected = () => assert.fail('composition performed external work');
  t.mock.method(globalThis, 'setTimeout', (run, delay) => { jobs.set(++timer, {run, delay}); return timer; });
  t.mock.method(globalThis, 'clearTimeout', id => jobs.delete(id));
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable:true, value:{getElementById:() => null, querySelector:() => null}});
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  const cap = createOrdersFinanceCapability({
    model, ui, checksSession:session, tab:{primaryTab:true},
    auth:{loadSession:() => ({user:{id:'A'}}), supaFetch:unexpected, ensureSession:unexpected},
    readAccess:() => ({account:{owner:'A',epoch:1}, connectionMode:'supabase', storageOwner:'A', readable:true, writable:true}),
    revisions:{read:() => revision, touchFinance:() => revision++, touchBankDisplay:() => revision++},
    runFinance:run => run(),
    platform:{
      effects:{isOnline:() => true, writeText:unexpected, saveJson:unexpected, delay:async () => {}, dispose:() => { disposed++; return true; }},
      bridge:{preferences:{getItem:key => preferences.get(key) ?? null, setItem:(key,value) => preferences.set(key,value), removeItem:key => preferences.delete(key)},
        clock:{now:() => 1000}, fetchRequest:unexpected, timers:globalThis, createAbortController:() => new AbortController()},
    },
  });
  const cloud = Object.fromEntries([
    'readKupaReadOnlyCloud','readKupaReadOnlyMeta','rpcSaveKupaDocument','readFinanceSyncDocument','rpcSaveFinanceSync',
    'claimFinanceSyncLease','releaseFinanceSyncLease','saveBankSyncSnapshot',
    'syncBankTransactionsSnapshot','readBankTransactions','readBankTransactionSnapshot',
    'setBankTransactionHandled','acknowledgeBankTransactionMissing','acknowledgeBankTransactionAlert',
  ].map(name => [name, async () => { network++; return null; }]));
  const readout = {cloud, display:{renderChecks:unexpected, renderSummary:unexpected, refreshAlerts:noop}};
  const core = {cloud, checks:{syncSharedChecksFromCloud:unexpected, saveSharedChecksToCloud:unexpected, hasLocalWork:() => false}, toast:noop};
  const view = {
    layout:{mountViewLayout:unexpected}, modal:{modal:unexpected, closeModal:unexpected, confirmDialog:unexpected},
    date:{dateEditorMarkup:unexpected}, checksView:{checksMarkup:unexpected, checksHeaderContextMarkup:unexpected, syncChecksBulkUi:unexpected},
    dashboard:{summaryMarkup:unexpected}, openBankMorningDocument:unexpected, toast:noop,
  };
  t.after(() => cap.runtime.dispose());
  return {cap, model, ui, session, cloud, preferences, jobs, readout, core, view, disposed:() => disposed, network:() => network};
}

test('Finance construction and each bind are inert, ordered and single use', t => {
  const f = fixture(t), {cap} = f;
  assert.throws(() => cap.queries.snapshot(), /core_not_bound/);
  assert.throws(() => cap.readout.refreshKupaReadout(), /readout_not_bound/);
  assert.throws(() => cap.actionPacks(), /ui_not_bound/);
  assert.throws(() => cap.bindCore(f.core), /readout_not_bound/);
  cap.bindReadout(f.readout);
  assert.throws(() => cap.bindReadout(f.readout), /readout_already_bound/);
  assert.throws(() => cap.bindUi(f.view), /core_not_bound/);
  assert.throws(() => cap.bindCore({...f.core, checks:{}}), /checks_syncSharedChecksFromCloud_required/);
  cap.bindCore(f.core);
  assert.throws(() => cap.bindCore(f.core), /core_already_bound/);
  assert.throws(() => cap.runtime.start(), /ui_not_bound/);
  cap.bindUi(f.view);
  assert.equal(cap.assertReady(), true);
  assert.throws(() => cap.bindUi(f.view), /ui_already_bound/);
  assert.equal(f.network(), 0);
  assert.equal(f.jobs.size, 0);
  assert.equal(f.preferences.size, 0);
  assert.equal(cap.controller, undefined);
  assert.equal(cap.bridge, undefined);
  assert.equal(cap.view, undefined);
  assert.equal(cap.operationScope, undefined);
});

test('Finance owns the exact action packs and retains their startup mutation metadata', t => {
  const f = fixture(t); f.cap.bindReadout(f.readout); f.cap.bindCore(f.core); f.cap.bindUi(f.view);
  const packs = f.cap.actionPacks(), actions = composeActionRegistry(packs);
  assert.deepEqual(packs.map(pack => pack.name), ['morning-reports', 'credit-order', 'finance-bank', 'finance-credit']);
  for (const action of ['refresh-orders-bank','refresh-orders-credit','credit-card-order-save','orders-cashflow-minimum']) {
    assert.equal(actions[action].startupMutationDomain, 'finance', action);
  }
  actions['set-orders-bank-data-view']({dataset:{clickArg0:'history'}});
  assert.equal(f.ui.bankDataView, 'history');
  f.cap.runtime.dispose();
  const before = structuredClone(f.ui);
  assert.equal(actions['set-orders-bank-data-view']({dataset:{clickArg0:'summary'}}), false);
  assert.equal(actions['refresh-orders-bank']({dataset:{}}), false);
  assert.deepEqual(f.ui, before);
  assert.equal(f.network(), 0);
});

test('unhydrated startup state is not read during any construction phase', t => {
  const f = fixture(t); f.model.state = null;
  f.cap.bindReadout(f.readout); f.cap.bindCore(f.core); f.cap.bindUi(f.view);
  assert.equal(f.cap.assertReady(), true);
  assert.equal(f.network(), 0); assert.equal(f.jobs.size, 0);
});

test('disposal owns automatic timers, rejects all new access and preserves independent state', t => {
  const f = fixture(t); f.cap.bindReadout(f.readout); f.cap.bindCore(f.core); f.cap.bindUi(f.view);
  f.preferences.set('netunim_kupa_bank_bridge_token_v1', 'synthetic');
  f.cap.runtime.start(); assert.equal(f.jobs.size, 2);
  const callbacks = [...f.jobs.values()].map(job => job.run), before = structuredClone(f.session);
  assert.equal(f.cap.runtime.dispose(), true);
  assert.equal(f.cap.runtime.dispose(), false);
  assert.equal(f.disposed(), 1); assert.equal(f.jobs.size, 0);
  for (const run of callbacks) run();
  assert.equal(f.network(), 0); assert.equal(f.jobs.size, 0);
  assert.throws(() => f.cap.runtime.start(), /finance_disposed/);
  assert.throws(() => f.cap.commands.resetCreditSync(), /finance_disposed/);
  assert.throws(() => f.cap.queries.snapshot(), /finance_disposed/);
  assert.deepEqual(f.session, before);
  assert.deepEqual(f.model.state.checks, []);
});

test('a held Finance read cannot publish after its capability is disposed', async t => {
  const f = fixture(t), entered = gate(), release = gate();
  f.cloud.readKupaReadOnlyCloud = async () => { entered.resolve(); await release.promise; return {revision:4,financeRevision:4,state:{bank:{currentBalance:120}}}; };
  f.cap.bindReadout(f.readout); f.cap.bindCore(f.core); f.cap.bindUi(f.view);
  const before = structuredClone(f.session), reading = f.cap.readout.refreshKupaReadout({force:true});
  await entered.promise; f.cap.runtime.dispose(); release.resolve();
  assert.equal(await reading, false);
  assert.deepEqual(f.session, before);
});

test('an explicit automatic wake retains opt-out policy and the other resource owner', async t => {
  const f = fixture(t); f.cap.bindReadout(f.readout); f.cap.bindCore(f.core); f.cap.bindUi(f.view);
  f.preferences.set('netunim_kupa_bank_bridge_token_v1', 'synthetic');
  f.cap.runtime.start(); assert.equal(f.jobs.size, 2);
  assert.equal(f.cap.commands.setAutomaticEnabled('bank', false), true);
  assert.equal(f.jobs.size, 1);
  assert.equal(await f.cap.runtime.wake('bank'), false);
  assert.equal(f.jobs.size, 1); assert.equal(f.network(), 0);
  assert.throws(() => f.cap.runtime.wake('unknown'), /finance_kind_required/);
  assert.throws(() => f.cap.commands.setAutomaticEnabled('unknown', true), /finance_kind_required/);
});

test('disposal while a confirmation is open cannot enter a later computer-owned Bridge write', async t => {
  const f = fixture(t), confirmation = gate();
  f.view.modal.confirmDialog = () => confirmation.promise;
  f.cap.bindReadout(f.readout); f.cap.bindCore(f.core); f.cap.bindUi(f.view);
  const actions = composeActionRegistry(f.cap.actionPacks());
  actions['delete-orders-bank-credentials']({dataset:{}});
  f.cap.runtime.dispose(); confirmation.resolve(true);
  for (let turn = 0; turn < 30; turn++) await Promise.resolve();
  assert.equal(f.network(), 0);
  assert.equal(f.preferences.size, 0);
});

test('status completion after presentation closes returns the operation result without DOM publication', async t => {
  const f = fixture(t), release = gate();
  let active = true, reads = 0, renders = 0;
  const status = createFinanceStatusView({
    ui:{currentView:'kupa'}, currentSection:() => 'bank', isActive:() => active,
    snapshot:() => { reads++; return {}; }, headerContextMarkup:noop, bankSyncPanelMarkup:noop, creditSyncPanelMarkup:noop,
    controller:{}, renderKupa:() => renders++, renderedData:() => null, bindBankForm:noop,
  });
  const running = status.refreshFinanceOperation('bank', () => release.promise);
  const initialReads = reads; active = false;
  status.refreshFinanceStatus('bank'); release.resolve(true);
  assert.equal(await running, true);
  assert.equal(reads, initialReads); assert.equal(renders, 0);
  f.cap.runtime.dispose();
});

test('the application composes Finance through its capability instead of constructing its internals', () => {
  const main = fs.readFileSync(new URL('../netunim-orders/site/assets/js/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /import[^\n]*(createDomainsFinance|createDomainsBank|createFinanceBridge|createFinanceOperationScope|createOrdersBankChequeImage|createCreditCardOrderView|createFinanceConnectionImporter)/);
  for (const stage of ['bindReadout','bindCore','bindUi','assertReady']) assert.ok(main.includes(`finance.${stage}(`), stage);
  assert.ok(main.indexOf('finance.bindCore(') < main.indexOf('finance.bindUi('));
  assert.ok(main.indexOf('finance.bindUi(') < main.indexOf('domainsCustomers.bindUi('));
  assert.match(main, /bankTransactions:finance\.customerBankPort\(\)/);
  assert.match(main, /\.\.\.finance\.actionPacks\(\)/);
});

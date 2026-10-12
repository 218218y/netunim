import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrdersChecksCapability} from '../netunim-orders/site/assets/js/composition/checks.js';
import {composeActionRegistry} from '../shared/action-registry.js';

const noop = () => {};
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }
function fixture(t) {
  const events = [], model = {state:null}, session = {localGeneration:0}, checksSession = {checksGeneration:0};
  const ui = {currentView:'checks', checksBulkSelected:new Set(), checkSearchValue:''}, confirmation = gate();
  let timer = 0;
  const jobs = new Map(), commit = gate(), entered = gate(), held = gate();
  const external = () => assert.fail('binding performed browser or network work');
  const timers = {setTimeout(run, delay) { jobs.set(++timer, {run, delay}); return timer; }, clearTimeout(id) { jobs.delete(id); }};
  t.mock.method(globalThis, 'setTimeout', timers.setTimeout);
  t.mock.method(globalThis, 'clearTimeout', timers.clearTimeout);
  const sharedChecksV2 = {requested:true, cloudReady:true, primaryReady:true, hasLocalWork:false,
    persist(operations) { events.push(['append', structuredClone(operations)]); return {emergencyDurable:false, committed:commit.promise}; },
    async sync() { events.push('sync'); entered.resolve(); await held.promise; return true; },
    async cloudState() { return {seq:0, base:{revision:1, ackSeq:0, owner:'A', epoch:'E', state:{checks:model.state.checks, bankEvents:[]}}, pending:false, flight:null, control:null}; },
  };
  const cap = createOrdersChecksCapability({model, ui, session, checksSession, files:{}, tab:{primaryTab:true}, sharedChecksV2,
    auth:{loadSession:() => ({user:{id:'A'}})}, touchRevision:() => events.push('revision'), platform:{isOnline:() => true, timers}});
  const view = {layout:{mountViewLayout:external}, bankImageContext:external};
  const editor = {
    date:Object.fromEntries(['checkDateEditorMarkup','setCheckDateValue','normalizeCheckModalDates','applyCheckDatePicker',
      'handleCheckDatePartBlur','handleCheckDatePartInput','handleCheckDatePartKeydown','openCheckDatePicker'].map(name => [name, external])),
    modal:{modal:external, closeModal:() => events.push('close'), confirmDialog:() => confirmation.promise}, toast:noop,
    finance:{readout:{renderKupaDependentView:external}, presentation:{renderKupa:external}},
  };
  const status = {toast:noop, setSave:noop, setChecksCloud:noop, refreshCloudTimestamp:noop};
  const persistence = {status, folder:{syncFolderAccessButton:noop, folderBackupAvailable:() => false, folderSaveTitle:() => ''},
    rejectMutation:() => false, writeFolder:external, refreshAlerts:noop};
  const sync = {status, financeReadout:{recomputeKupaNetFromCache:noop, renderKupaDependentView:noop}, writeFolder:external};
  t.after(() => { commit.resolve(); held.resolve(); confirmation.resolve(false); cap.runtime.dispose(); });
  return {cap, model, ui, session, checksSession, events, view, editor, persistence, sync, jobs, commit, confirmation, held, entered};
}
function bind(f) { f.cap.bindView(f.view); f.cap.bindEditor(f.editor); f.cap.bindPersistence(f.persistence); f.cap.bindSync(f.sync); }

test('Checks binds validated ports once without accessing unhydrated state or external IO', t => {
  const f = fixture(t);
  assert.throws(() => f.cap.assertReady(), /view_not_bound/);
  assert.throws(() => f.cap.bindEditor(f.editor), /view_not_bound/);
  assert.throws(() => f.cap.bindView({...f.view, layout:{}}), /mountViewLayout_required/);
  bind(f);
  for (const [method, port] of [['bindView', f.view], ['bindEditor', f.editor], ['bindPersistence', f.persistence], ['bindSync', f.sync]]) {
    assert.throws(() => f.cap[method](port), /already_bound/);
  }
  assert.equal(f.cap.assertReady(), true);
  assert.equal(f.model.state, null);
  assert.deepEqual(f.events, []); assert.equal(f.jobs.size, 0);
  assert.equal('controller' in f.cap, false); assert.equal('sync' in f.cap, false);
});

test('Checks action metadata survives ownership guards and disposal fences pending confirmation', async t => {
  const f = fixture(t); bind(f);
  f.model.state = {checks:[{id:'C', name:'retained', status:'בקופה'}]};
  const registry = composeActionRegistry([f.cap.actionPack()]);
  const action = registry['delete-check'];
  assert.equal(action.startupMutationDomain, 'checks');
  action({dataset:{clickArg0:'C'}});
  assert.equal(f.cap.runtime.dispose(), true); assert.equal(f.cap.runtime.dispose(), false);
  f.confirmation.resolve(true); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(f.model.state.checks.map(row => row.id), ['C']);
  assert.deepEqual(f.events, []);
  assert.equal(action({dataset:{clickArg0:'C'}}), false);
  assert.equal(await f.cap.commands.sync(), false);
  assert.throws(() => f.cap.bindSync(f.sync), /disposed/);
});

test('Checks preserves every typed append and drains a started cloud follow-up after its durable receipt', async t => {
  const f = fixture(t); bind(f); f.model.state = {checks:[]};
  const operations = [{type:'delete', collection:'checks', id:'C'}];
  assert.equal(f.cap.commands.scheduleSave('delete', {operations, deletedIds:['C']}), false);
  assert.deepEqual(f.events.find(Array.isArray), ['append', operations]);
  assert.equal(f.session.localUndurableGenerations.has('checks:1'), true);
  assert.equal(f.jobs.size, 2);
  const cloud = [...f.jobs.values()].find(job => job.delay === 260).run();
  await Promise.resolve();
  f.cap.runtime.cancelPending();
  let drained = false;
  const draining = f.cap.runtime.drain().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  f.commit.resolve(); await f.entered.promise;
  assert.equal(f.session.localUndurableGenerations.size, 0);
  assert.equal(drained, false);
  f.held.resolve(); await Promise.all([cloud, draining]);
  assert.equal(f.cap.runtime.isPending(), false);
  assert.equal(drained, true);
});

test('Checks owns and cancels its lazily created search timer', t => {
  const f = fixture(t); bind(f);
  const actions = f.cap.actionPack().actions;
  actions['render-checks-search']({value:'active', isConnected:true});
  assert.equal(f.ui.checkSearchValue, 'active'); assert.equal(f.jobs.size, 1);
  const stale = [...f.jobs.values()][0].run;
  f.cap.runtime.dispose(); assert.equal(f.jobs.size, 0);
  stale();
  assert.equal(actions['render-checks-search']({value:'closed'}), false);
  assert.equal(f.ui.checkSearchValue, 'active');
});

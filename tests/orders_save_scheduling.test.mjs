import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoragePersistence} from '../netunim-orders/site/assets/js/storage/persistence.js';
import {createSyncChecksPersistence} from '../netunim-orders/site/assets/js/sync/checks-persistence.js';

const noop = () => {};
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function settle() {
  for (let turn = 0; turn < 30; turn++) await Promise.resolve();
}
function fixture(t, {mainDurable=true, checksDurable=true, folderAvailable=true}={}) {
  t.mock.timers.enable({apis:['setTimeout']});
  const session = {localGeneration:0}, checksSession = {checksGeneration:0};
  const mainCommit = deferred(), checksCommit = deferred();
  const events = [], staged = [], errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  const common = {
    session, checksSession, tab:{primaryTab:true},
    setSave:noop, setCloud:noop, toast:noop, showSecondaryTabGuard:noop,
    folderSaveTitle:() => '', folderBackupAvailable:() => folderAvailable,
    syncFolderAccessButton:noop, writeStateToFolder:async () => { events.push('folder'); return true; },
  };
  const main = createStoragePersistence({
    ...common, cloudEnabled:() => true,
    localSnapshot:(_state, options) => { staged.push(['main', options.operations]); return mainDurable; },
    storageV2DurabilityAtRisk:() => !mainDurable,
    storageV2CommitPromise:() => mainCommit.promise,
    requestCloudSave:async message => { events.push(['main-cloud', message]); },
  });
  const checks = createSyncChecksPersistence({
    ...common, rejectSecondaryMutation:() => false,
    loadSession:() => ({user:{id:'A'}}),
    sharedChecksV2:{requested:true, cloudReady:true, persist:operations => {
      staged.push(['checks', operations]);
      return {emergencyDurable:checksDurable, committed:checksCommit.promise};
    }},
    saveSharedChecksToCloud:async message => { events.push(['checks-cloud', message]); },
  });
  return {main, checks, mainCommit, checksCommit, events, staged, errors, session, checksSession};
}

test('interleaved bursts journal every edit and independently coalesce each document', async t => {
  const f = fixture(t);
  for (let edit = 0; edit < 4; edit++) {
    f.main.scheduleSave(`Main ${edit}`, {operations:mainOperations});
    f.checks.scheduleCheckSave(`Check ${edit}`, {operations:checkOperations});
    t.mock.timers.tick(50);
  }
  assert.equal(f.staged.length, 8);
  f.mainCommit.resolve(true); f.checksCommit.resolve(true);
  t.mock.timers.tick(400); await settle();
  assert.deepEqual(f.events.filter(Array.isArray).sort(), [['checks-cloud', 'Check 3'], ['main-cloud', 'Main 3']]);
  assert.equal(Object.hasOwn(f.session, 'saveTimer'), false);
  assert.equal(Object.hasOwn(f.checksSession, 'sharedChecksSaveTimer'), false);
});

for (const failed of ['main', 'checks']) {
  test(`a failed ${failed} IDB-only commit retains its risk and cannot suppress the other document`, async t => {
    const f = fixture(t, {mainDurable:false, checksDurable:false, folderAvailable:false});
    assert.equal(f.main.scheduleSave('Main edit', {operations:mainOperations}), false);
    assert.equal(f.checks.scheduleCheckSave('Check edit', {operations:checkOperations}), false);
    t.mock.timers.tick(300); await settle();
    f[failed === 'main' ? 'mainCommit' : 'checksCommit'].reject(Error('injected abort'));
    f[failed === 'main' ? 'checksCommit' : 'mainCommit'].resolve(true);
    await settle();
    assert.deepEqual(f.events.filter(Array.isArray), [failed === 'main' ? ['checks-cloud', 'Check edit'] : ['main-cloud', 'Main edit']]);
    assert.equal(f.session.localUndurableGenerations.has(failed === 'main' ? 1 : 'checks:2'), true);
    assert.equal(f.errors.length > 0, true);
  });
}

for (const cancelled of ['main', 'checks']) {
  test(`cancelling ${cancelled} follow-ups cannot cancel another owner's work or local receipts`, async t => {
    const f = fixture(t, {mainDurable:false, checksDurable:false});
    f.main.scheduleSave('Main edit', {operations:mainOperations});
    f.checks.scheduleCheckSave('Check edit', {operations:checkOperations});
    assert.equal(f[cancelled].runtime.cancelPending(), true);
    assert.equal(f[cancelled].runtime.cancelPending(), false);
    f.mainCommit.resolve(true); f.checksCommit.resolve(true);
    t.mock.timers.tick(300); await settle();
    assert.deepEqual(f.events.filter(Array.isArray), [cancelled === 'main' ? ['checks-cloud', 'Check edit'] : ['main-cloud', 'Main edit']]);
    assert.equal(f.session.localUndurableGenerations.size, 0);
    assert.equal(f.session.cloudSaveRequested, true);
    assert.equal(f.checksSession.checksSaveRequested, true);
  });
}

test('dispose prevents new edits and drains started follow-ups without aborting their commit', async t => {
  const f = fixture(t);
  f.main.scheduleSave('Main edit', {operations:mainOperations});
  f.checks.scheduleCheckSave('Check edit', {operations:checkOperations});
  t.mock.timers.tick(300); await settle();
  for (const owner of [f.main, f.checks]) {
    assert.equal(owner.runtime.dispose(), true);
    assert.equal(owner.runtime.dispose(), false);
  }
  let drained = false;
  const drain = Promise.all([f.main.runtime.drain(), f.checks.runtime.drain()]).then(() => { drained = true; });
  await settle(); assert.equal(drained, false);
  assert.equal(f.main.scheduleSave('rejected', {operations:mainOperations}), false);
  assert.equal(f.checks.scheduleCheckSave('rejected', {operations:checkOperations}), false);
  assert.equal(f.staged.length, 2);
  f.mainCommit.resolve(true); f.checksCommit.resolve(true); await drain;
  assert.equal(f.events.filter(Array.isArray).length, 2);
});
const mainOperations = [{type:'put', collection:'notes', id:'N', mode:'replace', record:{id:'N', content:'edit'}}];
const checkOperations = [{type:'put', collection:'checks', id:'C', mode:'replace', record:{id:'C', amount:100}}];

for (const first of ['main', 'checks']) {
  test(`${first} edit followed 50ms later by the other document retains both cloud obligations`, async t => {
    const f = fixture(t);
    const edit = name => name === 'main'
      ? f.main.scheduleSave('Main edit', {operations:mainOperations})
      : f.checks.scheduleCheckSave('Check edit', {operations:checkOperations});
    assert.equal(edit(first), true);
    t.mock.timers.tick(50);
    assert.equal(edit(first === 'main' ? 'checks' : 'main'), true);
    assert.equal(f.staged.length, 2, 'both journals stage before a wakeup');
    t.mock.timers.tick(300);
    await settle();
    assert.deepEqual(f.events.filter(Array.isArray), [], 'neither cloud write precedes its local commit');
    f.mainCommit.resolve(true);
    f.checksCommit.resolve(true);
    await settle();
    assert.deepEqual(f.events.filter(Array.isArray).sort(), [
      ['checks-cloud', 'Check edit'], ['main-cloud', 'Main edit'],
    ]);
    assert.equal(f.events.filter(event => event === 'folder').length, 2);
    assert.equal(f.session.cloudSaveRequested, true);
    assert.equal(f.checksSession.checksSaveRequested, true);
  });
}

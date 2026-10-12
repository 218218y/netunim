import test from 'node:test';
import assert from 'node:assert/strict';
import {createDebouncedTask} from '../shared/debounced-task.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
async function settle() { for (let turn = 0; turn < 30; turn++) await Promise.resolve(); }
function fixture() {
  let sequence = 0;
  const jobs = new Map(), errors = [];
  const timers = {
    setTimeout(run, delay) { const id = ++sequence; jobs.set(id, {run, delay}); return id; },
    clearTimeout(id) { jobs.delete(id); },
  };
  const task = createDebouncedTask({delay:180, timers, onError:error => errors.push(error)});
  function fire() {
    const [id, job] = jobs.entries().next().value;
    jobs.delete(id);
    return job.run();
  }
  return {task, timers, jobs, errors, fire};
}

test('one owner replaces only its pending wakeup and uses the original delay', async () => {
  const f = fixture(), called = [];
  assert.equal(f.jobs.size, 0);
  f.task.schedule(() => called.push('old'));
  const stale = [...f.jobs.values()][0].run;
  f.task.schedule(() => called.push('latest'));
  assert.equal(f.jobs.size, 1);
  assert.equal([...f.jobs.values()][0].delay, 180);
  stale();
  await settle();
  assert.deepEqual(called, []);
  assert.equal(f.jobs.size, 1);
  assert.equal(f.fire(), undefined, 'the native timer callback never returns a rejected promise');
  await f.task.drain();
  assert.deepEqual(called, ['latest']);
  assert.equal(f.jobs.size, 0);
});

test('a ready follow-up waits for started work and retains only the newest callback', async () => {
  const f = fixture(), gate = deferred(), called = [];
  f.task.schedule(async () => { called.push('start'); await gate.promise; called.push('finish'); });
  f.fire(); await settle();
  f.task.schedule(() => called.push('superseded')); f.fire(); await settle();
  f.task.schedule(() => called.push('latest')); f.fire(); await settle();
  assert.deepEqual(called, ['start']);
  let drained = false;
  const drain = f.task.drain().then(() => { drained = true; });
  await settle(); assert.equal(drained, false);
  gate.resolve(); await drain;
  assert.deepEqual(called, ['start', 'finish', 'latest']);
});

for (const stop of ['cancel', 'dispose']) {
  test(`${stop} cancels an overdue follow-up while draining an already started commit`, async () => {
    const f = fixture(), gate = deferred(), called = [];
    f.task.schedule(async () => { called.push('start'); await gate.promise; called.push('finish'); });
    f.fire(); await settle();
    f.task.schedule(() => called.push('cancelled')); f.fire(); await settle();
    assert.equal(f.task[stop](), true);
    assert.equal(f.task[stop](), false);
    let drained = false;
    const drain = f.task.drain().then(() => { drained = true; });
    await settle(); assert.equal(drained, false);
    gate.resolve(); await drain;
    assert.deepEqual(called, ['start', 'finish']);
    assert.equal(f.task.schedule(() => called.push('next')), stop === 'cancel');
    if (stop === 'cancel') { f.fire(); await f.task.drain(); assert.equal(called.at(-1), 'next'); }
    assert.equal(f.jobs.size, 0);
  });

  test(`${stop} fences a timer delivered before task entry`, async () => {
    const f = fixture(), called = [];
    f.task.schedule(() => called.push('cancelled')); f.fire();
    assert.equal(f.task[stop](), true);
    await f.task.drain();
    assert.deepEqual(called, []);
  });
}

for (const asynchronous of [false, true]) {
  test(`a ${asynchronous ? 'rejected promise' : 'throw'} is observed and a later wakeup still runs`, async () => {
    const f = fixture(), failure = Error('injected failure'), called = [];
    f.task.schedule(() => { if (asynchronous) return Promise.reject(failure); throw failure; });
    f.fire(); await f.task.drain();
    assert.deepEqual(f.errors, [failure]);
    f.task.schedule(() => called.push('recovered')); f.fire(); await f.task.drain();
    assert.deepEqual(called, ['recovered']);
  });
}

test('failed timer allocation reports the original failure and leaves no pending work', async () => {
  const failure = Error('timer allocation'), errors = [];
  const task = createDebouncedTask({delay:180, timers:{setTimeout() { throw failure; }, clearTimeout() {}}, onError:error => errors.push(error)});
  assert.equal(task.schedule(() => {}), false);
  assert.deepEqual(errors, [failure]);
  assert.equal(task.cancel(), false);
  await task.drain();
});

test('invalid ports and callbacks fail before scheduling', () => {
  const f = fixture();
  for (const delay of [-1, NaN, Infinity]) assert.throws(() => createDebouncedTask({delay, onError:() => {}}), /ports_required/);
  assert.throws(() => f.task.schedule(null), /run_required/);
  assert.equal(f.jobs.size, 0);
});

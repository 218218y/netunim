import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFileTaskOwner,
  joinFileAttempts,
} from '../netunim-kupa/bank-bridge/file-task-owner.mjs';
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('file ownership serializes accepted jobs and preserves their results after a failed job', async () => {
  const owner = createFileTaskOwner(),
    gate = deferred(),
    started = deferred(),
    events = [],
    failure = new Error('disk full');
  const first = owner.run(async () => {
    events.push('first');
    started.resolve();
    await gate.promise;
    throw failure;
  });
  const rejected = assert.rejects(first, (error) => error === failure);
  const second = owner.run(() => {
    events.push('second');
    return 42;
  });
  await started.promise;
  assert.deepEqual(events, ['first']);
  gate.resolve();
  await rejected;
  assert.equal(await second, 42);
  await owner.drain();
  assert.deepEqual(events, ['first', 'second']);
});

test('joining file attempts preserves first observed failure while waiting for every accepted sibling', async () => {
  let failFirst, failLater;
  const first = new Promise((resolve, reject) => {
      failLater = reject;
    }),
    second = new Promise((resolve, reject) => {
      failFirst = reject;
    });
  const original = new Error('first observed'),
    later = new Error('later failure');
  let completed = false;
  const joined = joinFileAttempts([first, second]),
    rejected = assert
      .rejects(joined, (error) => error === original)
      .then(() => {
        completed = true;
      });
  failFirst(original);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  failLater(later);
  await rejected;
  assert.deepEqual(await joinFileAttempts([Promise.resolve(42), Promise.resolve(7)]), [42, 7]);
});

test('drain joins a new file job accepted while an earlier job is finishing', async () => {
  const owner = createFileTaskOwner(),
    firstGate = deferred(),
    lastGate = deferred(),
    entered = deferred();
  let drained = false;
  const first = owner.run(async () => {
    await firstGate.promise;
    owner.run(async () => {
      entered.resolve();
      await lastGate.promise;
    });
  });
  const draining = owner.drain().then(() => {
    drained = true;
  });
  firstGate.resolve();
  await entered.promise;
  assert.equal(drained, false);
  lastGate.resolve();
  await first;
  await draining;
  assert.equal(drained, true);
});

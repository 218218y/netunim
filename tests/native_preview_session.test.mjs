import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativePreviewSession} from '../netunim-orders/document-bridge/native-preview-session.mjs';
import {previewFixture, deferred} from './native_preview_fixture.mjs';

test('parallel first commands share one prepared preview process and readiness handshake', async () => {
  const preparation = deferred(), f = previewFixture(createNativePreviewSession, {prepare: () => preparation.promise});
  const a = f.session.command('OPEN', ['a']), b = f.session.command('MOVE', [1, 2]);
  preparation.resolve();
  assert.deepEqual(await Promise.all([a, b]), ['OPEN-done', 'MOVE-done']);
  assert.equal(f.children.length, 1);
  assert.equal(f.preparations(), 1);
  assert.deepEqual(f.children[0].commands.map(item => item.command), ['PING', 'OPEN', 'MOVE']);
  assert.equal(f.jobs.size, 0);
});

test('a former process exit cannot reject a command owned by its replacement', async () => {
  const requested = deferred(), f = previewFixture(createNativePreviewSession, {respond: (child, {id, command}) => {
    if (command === 'PING' || child.pid === 1) queueMicrotask(() => child.stdout.emit('data', `${id}\tOK\tdone\n`));
    else requested.resolve({child, id});
  }});
  await f.session.command('OPEN', ['first']);
  const old = f.children[0]; old.killed = true;
  const current = f.session.command('OPEN', ['next']);
  const outcome = current.then(value => ({value}), error => ({error}));
  const {child, id} = await requested.promise;
  old.emit('exit', 0, null); old.emit('error', new Error('late former process error'));
  child.stdout.emit('data', `${id}\tOK\tnew-result\n`);
  assert.equal((await outcome).value, 'new-result');
  assert.equal(f.session.isRunning(), true);
  assert.equal(f.jobs.size, 0);
});

test('former partial output cannot enter the replacement response buffer', async () => {
  const requested = deferred(), f = previewFixture(createNativePreviewSession, {respond: (child, {id, command}) => {
    if (command === 'PING' || child.pid === 1) queueMicrotask(() => child.stdout.emit('data', `${id}\tOK\tdone\n`));
    else requested.resolve({child, id});
  }});
  await f.session.command('OPEN');
  const old = f.children[0]; old.emit('exit', 0, null);
  const current = f.session.command('MOVE'), {child, id} = await requested.promise;
  old.stdout.emit('data', 'old-partial');
  child.stdout.emit('data', `${id}\tOK\tfresh`); child.stdout.emit('data', '-frame\r\n');
  assert.equal(await current, 'fresh-frame');
  assert.equal(f.jobs.size, 0);
});

test('all callers wait for readiness rather than entering an unconfirmed process', async () => {
  const ping = deferred(), f = previewFixture(createNativePreviewSession, {respond: (child, {id, command}) => {
    if (command === 'PING') ping.resolve({child, id});
    else queueMicrotask(() => child.stdout.emit('data', `${id}\tOK\tdone\n`));
  }});
  const a = f.session.command('OPEN'), b = f.session.command('HIDE');
  const {child, id} = await ping.promise;
  assert.deepEqual(child.commands.map(item => item.command), ['PING']);
  child.stdout.emit('data', `${id}\tOK\tPONG\n`);
  await Promise.all([a, b]);
  assert.deepEqual(child.commands.map(item => item.command), ['PING', 'OPEN', 'HIDE']);
});

test('timeout retires only its command and ignores a late response', async () => {
  const pending = deferred(), f = previewFixture(createNativePreviewSession, {respond: (child, {id, command}) => {
    if (command === 'PING') queueMicrotask(() => child.stdout.emit('data', `${id}\tOK\tPONG\n`));
    else pending.resolve({child, id});
  }});
  const work = f.session.command('OPEN'), outcome = assert.rejects(work, {code: 'NATIVE_PREVIEW_TIMEOUT'});
  const {child, id} = await pending.promise;
  f.expire(); await outcome;
  child.stdout.emit('data', `${id}\tOK\ttoo-late\n`);
  assert.equal(f.jobs.size, 0);
  assert.equal(f.session.isRunning(), true);
});

test('handshake timeout terminates its unready child and permits a clean explicit request', async () => {
  const launched = deferred(), f = previewFixture(createNativePreviewSession, {respond: (child, {id}) => {
    if (child.pid === 1) launched.resolve(child);
    else queueMicrotask(() => child.stdout.emit('data', `${id}\tOK\trecovered\n`));
  }});
  const first = f.session.command('OPEN'), rejected = assert.rejects(first, {code: 'NATIVE_PREVIEW_TIMEOUT'});
  const old = await launched.promise; f.expire(); await rejected;
  assert.equal(old.killed, true);
  assert.equal(f.jobs.size, 0);
  assert.equal(await f.session.command('OPEN'), 'recovered');
  assert.equal(f.children.length, 2);
});

test('write callback failure preserves its error and drains the owned timer', async () => {
  const f = previewFixture(createNativePreviewSession);
  await f.session.command('OPEN');
  const child = f.children[0], failure = Object.assign(new Error('closed pipe'), {code: 'EPIPE'});
  child.stdin.write = (line, encoding, callback) => callback(failure);
  await assert.rejects(f.session.command('OPEN'), error => error === failure);
  assert.equal(f.jobs.size, 0);
});

test('protocol error response preserves existing diagnostic code and message', async () => {
  const f = previewFixture(createNativePreviewSession, {respond: (child, {id, command}) => {
    queueMicrotask(() => child.stdout.emit('data', `${id}\t${command === 'PING' ? 'OK' : 'ERR'}\tpreview denied\n`));
  }});
  await assert.rejects(f.session.command('OPEN'), {code: 'NATIVE_PREVIEW_FAILED', message: 'preview denied'});
  assert.equal(f.jobs.size, 0);
});

test('a live child exit rejects every owned command without affecting later startup', async () => {
  const started = deferred(), f = previewFixture(createNativePreviewSession, {respond: (child, {id, command}) => {
    if (command === 'PING' || child.pid > 1) queueMicrotask(() => child.stdout.emit('data', `${id}\tOK\tdone\n`));
    else started.resolve(child);
  }});
  const a = f.session.command('OPEN'), b = f.session.command('MOVE');
  const rejected = Promise.all([assert.rejects(a, {code: 'NATIVE_PREVIEW_HOST_EXITED'}), assert.rejects(b, {code: 'NATIVE_PREVIEW_HOST_EXITED'})]);
  const child = await started.promise; child.exitCode = 1; child.emit('exit', 1, null);
  await rejected;
  assert.equal(f.jobs.size, 0);
  assert.equal(await f.session.command('OPEN'), 'done');
});

test('dispose during preparation prevents launch and is terminal', async () => {
  const preparation = deferred(), f = previewFixture(createNativePreviewSession, {prepare: () => preparation.promise});
  const work = f.session.command('OPEN'), rejected = assert.rejects(work, {code: 'NATIVE_PREVIEW_HOST_EXITED'});
  const stopped = f.session.dispose(); preparation.resolve();
  await Promise.all([rejected, stopped]);
  assert.equal(f.children.length, 0);
  await assert.rejects(f.session.command('OPEN'), {code: 'NATIVE_PREVIEW_HOST_EXITED'});
});

test('stop joins one teardown and prevents replacement commands until the process exits', async () => {
  const termination = deferred(), entered = deferred(), f = previewFixture(createNativePreviewSession, {terminate: () => { entered.resolve(); return termination.promise; }});
  await f.session.command('OPEN');
  const a = f.session.stop(), b = f.session.stop(); await entered.promise;
  await assert.rejects(f.session.command('OPEN'), {code: 'NATIVE_PREVIEW_HOST_EXITED'});
  assert.equal(f.children.length, 1);
  termination.resolve(); await Promise.all([a, b]);
  assert.equal(await f.session.command('OPEN'), 'OPEN-done');
  assert.equal(f.children.length, 2);
});

test('failed termination blocks replacement until explicit successful stop', async () => {
  let failing = true;
  const failure = Object.assign(new Error('process still alive'), {code: 'NATIVE_PREVIEW_STOP_FAILED'});
  const f = previewFixture(createNativePreviewSession, {terminate: async () => { if (failing) throw failure; }});
  await f.session.command('OPEN');
  await assert.rejects(f.session.stop(), error => error === failure);
  await assert.rejects(f.session.command('OPEN'), error => error === failure);
  assert.equal(f.children.length, 1);
  failing = false; await f.session.stop();
  assert.equal(await f.session.command('OPEN'), 'OPEN-done');
});

test('stopping cancels owned display commands while preserving its graceful EXIT handshake', async () => {
  const opened = deferred(), exiting = deferred(), f = previewFixture(createNativePreviewSession, {respond: (child, {id, command}) => {
    if (command === 'PING') queueMicrotask(() => child.stdout.emit('data', `${id}\tOK\tPONG\n`));
    else if (command === 'EXIT') exiting.resolve({child, id});
    else opened.resolve({child, id});
  }});
  const work = f.session.command('OPEN'), rejected = assert.rejects(work, {code: 'NATIVE_PREVIEW_HOST_EXITED'});
  const original = await opened.promise, stopping = f.session.stop();
  const exit = await exiting.promise;
  original.child.stdout.emit('data', `${original.id}\tOK\tstale-open\n`);
  exit.child.stdout.emit('data', `${exit.id}\tOK\tBYE\n`);
  await Promise.all([rejected, stopping]);
  assert.equal(f.jobs.size, 0);
  assert.equal(f.session.isRunning(), false);
});

test('host-error cleanup and concurrent stop share one termination', async () => {
  const termination = deferred(), entered = deferred(); let count = 0;
  const f = previewFixture(createNativePreviewSession, {terminate: () => { count++; entered.resolve(); return termination.promise; }});
  await f.session.command('OPEN');
  f.children[0].emit('error', new Error('host fault'));
  await entered.promise;
  const stopping = f.session.stop(); termination.resolve(); await stopping;
  assert.equal(count, 1);
  assert.equal(f.jobs.size, 0);
});

test('a confirmed exit of the blocked owner permits recovery after an earlier failed termination', async () => {
  const failure = Object.assign(new Error('process still alive'), {code: 'NATIVE_PREVIEW_STOP_FAILED'});
  const f = previewFixture(createNativePreviewSession, {terminate: async () => { throw failure; }});
  await f.session.command('OPEN');
  await assert.rejects(f.session.stop(), error => error === failure);
  await assert.rejects(f.session.command('OPEN'), error => error === failure);
  const old = f.children[0]; old.exitCode = 0; old.emit('exit', 0, null);
  assert.equal(await f.session.command('OPEN'), 'OPEN-done');
  assert.equal(f.children.length, 2);
});

test('100 stop/start cycles release timers and stream listeners with no old owner callback', async () => {
  const f = previewFixture(createNativePreviewSession);
  for (let i = 0; i < 100; i++) {
    await f.session.command('OPEN', ['line\r\nwith\ttabs', i]);
    const child = f.children.at(-1);
    assert.deepEqual(child.commands[1].args, ['line  with tabs', String(i)]);
    await f.session.stop(); child.emit('close', 0, null);
    assert.equal(child.stdout.listenerCount('data'), 0); assert.equal(child.stderr.listenerCount('data'), 0);
    assert.equal(child.listenerCount('error'), 0); assert.equal(child.listenerCount('exit'), 0);
    assert.equal(child.listenerCount('close'), 0); assert.equal(f.jobs.size, 0);
  }
  await f.session.dispose(); await f.session.dispose();
  assert.equal(f.children.length, 100);
});

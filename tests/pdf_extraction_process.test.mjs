import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { createPdfExtractionProcess } from '../netunim-orders/document-bridge/pdf-extraction-process.mjs';
import { baseline, extracted, plain } from './pdf_preview_fixture.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(version = 'current', limits = {}) {
  const timers = new Map(),
    child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.stdin = { end: () => {} };
  let kills = 0,
    starts = 0;
  child.kill = () => {
    kills++;
  };
  const runtime = {
    setTimeout: (fn, ms) => {
      const handle = {};
      timers.set(handle, { fn, ms });
      return handle;
    },
    clearTimeout: handle => timers.delete(handle)
  };
  const owner =
    version === 'baseline'
      ? {
          read: vm.runInNewContext(
            baseline.functions.extractPdfOnDemand.source +
              '\nextractPdfOnDemand',
            {
              spawn: () => child,
              process: { execPath: 'node' },
              path: { join: () => '' },
              RUNTIME_ROOT: '',
              APP_ROOT: '',
              ...runtime
            }
          )
        }
      : createPdfExtractionProcess(
          {
            worker: {
              start: (_request, events) => {
                starts++;
                child.stdout.on('data', events.output);
                child.stderr.on('data', events.errorOutput);
                child.on('error', events.error);
                child.on('close', events.close);
                return { kill: child.kill };
              }
            },
            runtime
          },
          limits
        );
  return { owner, child, timers, kills: () => kills, starts: () => starts };
}

test('baseline timeout settles before worker close; current timeout and output overflow retain ownership until close', async () => {
  const old = fixture('baseline');
  let released = false;
  const oldRead = old.owner.read('synthetic').catch(() => {
    released = true;
  });
  [...old.timers.values()][0].fn();
  await oldRead;
  assert.equal(released, true);
  assert.equal(old.kills(), 1);
  for (const reason of ['timeout', 'overflow', 'error', 'abort', 'dispose']) {
    const f = fixture('current', { maxOutputChars: 20 }),
      signal = new AbortController();
    let done = false;
    const reading = f.owner.read('synthetic', { signal: signal.signal }),
      rejected = assert.rejects(reading).then(() => {
        done = true;
      });
    let stopping;
    if (reason === 'timeout') [...f.timers.values()][0].fn();
    else if (reason === 'overflow') f.child.stdout.emit('data', 'x'.repeat(21));
    else if (reason === 'error')
      f.child.emit('error', new Error('pipe failed'));
    else if (reason === 'abort') signal.abort();
    else stopping = f.owner.dispose();
    await tick();
    assert.equal(done, false, reason);
    assert.ok(f.kills() >= 1);
    f.child.emit('close', 1);
    await Promise.all([rejected, stopping]);
    assert.equal(done, true);
    assert.equal(f.timers.size, 0);
    await f.owner.dispose();
  }
});

test('default budgets, chunked Unicode success, bounded diagnostics and first failure cause remain stable', async () => {
  const f = fixture(),
    controller = new AbortController(),
    reading = f.owner.read('synthetic', { signal: controller.signal });
  assert.equal([...f.timers.values()][0].ms, 25000);
  const response = JSON.stringify({ ok: true, result: extracted });
  for (let i = 0; i < response.length; i += 7)
    f.child.stdout.emit('data', response.slice(i, i + 7));
  f.child.emit('close', 0);
  assert.deepEqual(plain(await reading), extracted);
  assert.equal(f.timers.size, 0);
  controller.abort();
  assert.equal(f.kills(), 0);
  await f.owner.dispose();
  const bounded = fixture('current', { maxErrorChars: 4 }),
    failure = bounded.owner.read('synthetic');
  bounded.child.stderr.emit('data', '12345678');
  bounded.child.stdout.emit('data', JSON.stringify({ ok: false }));
  bounded.child.emit('close', 1);
  await assert.rejects(failure, /exited 1: 1234$/);
  await bounded.owner.dispose();
  const first = fixture(),
    error = Object.assign(new Error('original pipe fault'), { code: 'EPIPE' }),
    promise = first.owner.read('synthetic');
  first.child.emit('error', error);
  [...first.timers.values()][0].fn();
  first.child.emit('close', 1);
  await assert.rejects(promise, value => value === error);
  await first.owner.dispose();
});

test('aborted and disposed requests never launch, and repeated disposal joins the same accepted worker', async () => {
  const f = fixture(),
    abort = new AbortController();
  abort.abort();
  await assert.rejects(f.owner.read('synthetic', { signal: abort.signal }), {
    code: 'ABORT_ERR'
  });
  assert.equal(f.starts(), 0);
  const reading = f.owner.read('synthetic'),
    rejected = assert.rejects(reading, { code: 'PDF_EXTRACTION_DISPOSED' });
  let done = false;
  const stopping = Promise.all([f.owner.dispose(), f.owner.dispose()]).then(
    () => {
      done = true;
    }
  );
  await tick();
  assert.equal(done, false);
  await assert.rejects(f.owner.read('late'), {
    code: 'PDF_EXTRACTION_DISPOSED'
  });
  assert.equal(f.starts(), 1);
  f.child.emit('close', 1);
  await Promise.all([rejected, stopping]);
  assert.equal(f.timers.size, 0);
});

test('synchronous native launch failure rejects without leaving timers or pending children', async () => {
  const error = Object.assign(new Error('missing worker'), { code: 'ENOENT' });
  let timers = 0;
  const owner = createPdfExtractionProcess({
    worker: {
      start: () => {
        throw error;
      }
    },
    runtime: {
      setTimeout: () => {
        timers++;
        return {};
      },
      clearTimeout: () => {
        timers--;
      }
    }
  });
  await assert.rejects(owner.read('synthetic'), value => value === error);
  await owner.dispose();
  assert.equal(timers, 0);
});

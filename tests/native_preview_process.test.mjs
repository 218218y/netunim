import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createNativePreviewSession} from '../netunim-orders/document-bridge/native-preview-session.mjs';

function fixture(t) {
  const children = [], jobs = new Set();
  const session = createNativePreviewSession({host: {
    prepare: async () => {},
    launch: () => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/native_preview_protocol_host.mjs', import.meta.url))],
        {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
      child.closed = new Promise(resolve => child.once('close', resolve));
      children.push(child); return child;
    },
    terminate: async child => {
      let deadline;
      try { await Promise.race([child.closed, new Promise(resolve => { deadline = setTimeout(resolve, 1200); })]); }
      finally { clearTimeout(deadline); }
      if (child.exitCode === null && !child.killed) child.kill();
      await child.closed;
    },
  }, timers: {
    setTimeout: (callback, delay) => { const timer = setTimeout(() => { jobs.delete(timer); callback(); }, delay); jobs.add(timer); return timer; },
    clearTimeout: timer => { jobs.delete(timer); clearTimeout(timer); },
  }, log: async () => {}});
  t.after(async () => { await session.dispose(); for (const child of children) { if (child.exitCode === null && !child.killed) child.kill(); await child.closed; } });
  return {session, children, jobs};
}

test('real child pipes share one process across 25 concurrent commands and preserve UTF-8 framing', async t => {
  const f = fixture(t);
  const values = await Promise.all(Array.from({length: 25}, (_, i) => f.session.command('OPEN', ['דו״ח\r\nתיקיה\tשם', i])));
  assert.equal(f.children.length, 1);
  assert.deepEqual(values, Array.from({length: 25}, (_, i) => `דו״ח  תיקיה שם|${i}`));
  await f.session.stop(); await f.children[0].closed;
  assert.equal(f.children[0].exitCode, 0);
  assert.equal(f.children[0].stdout.listenerCount('data'), 0);
  assert.equal(f.children[0].listenerCount('error'), 0);
  assert.equal(f.jobs.size, 0);
});

test('real process death rejects the owned command then restarts on an explicit next command', async t => {
  const f = fixture(t);
  await assert.rejects(f.session.command('DIE'), {code: 'NATIVE_PREVIEW_HOST_EXITED'});
  await f.children[0].closed;
  assert.equal(f.children[0].exitCode, 7);
  assert.equal(await f.session.command('HIDE'), 'HIDE');
  assert.equal(f.children.length, 2);
  assert.equal(f.jobs.size, 0);
});

test('a silent real pipe has a classified bounded timeout and disposes without an orphan process', async t => {
  const f = fixture(t);
  await assert.rejects(f.session.command('SILENT', [], 100), {code: 'NATIVE_PREVIEW_TIMEOUT'});
  await f.session.dispose(); await f.children[0].closed;
  assert.equal(f.jobs.size, 0);
  assert.equal(f.children[0].exitCode, 0);
  await assert.rejects(f.session.command('OPEN'), {code: 'NATIVE_PREVIEW_HOST_EXITED'});
});

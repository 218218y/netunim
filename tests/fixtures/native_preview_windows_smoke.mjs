import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const [runtime, applicationRoot] = process.argv.slice(2);
const {createNativePreviewSession} = await import(pathToFileURL(path.join(runtime, 'native-preview-session.mjs')));
const {createNativePreviewHostPlatform} = await import(pathToFileURL(path.join(runtime, 'native-preview-platform.mjs')));
const children = new Map(), timers = new Set();
const processes = {
  alive: async pid => children.has(pid) && children.get(pid).exitCode === null,
  waitForExit: async (pid, timeout) => {
    const child = children.get(pid);
    if (!child || child.exitCode !== null) return true;
    let deadline;
    try { await Promise.race([child.closed, new Promise(resolve => { deadline = setTimeout(resolve, timeout); })]); }
    finally { clearTimeout(deadline); }
    return child.exitCode !== null;
  },
  forceStopTree: async pid => { const child = children.get(pid); if (child) { child.kill(); await child.closed; } },
};
const platform = createNativePreviewHostPlatform({hostPath: path.join(runtime, 'NetunimPreviewHost.exe'), applicationRoot, processes, log: async () => {}});
const launch = platform.launch;
platform.launch = () => {
  const child = launch();
  child.closed = new Promise(resolve => child.once('close', resolve));
  children.set(child.pid, child);
  return child;
};
const session = createNativePreviewSession({host: platform, log: async () => {}, timers: {
  setTimeout: (callback, delay) => { const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay); timers.add(timer); return timer; },
  clearTimeout: timer => { clearTimeout(timer); timers.delete(timer); },
}});
try {
  // PING/HIDE do not open Office files, dialogs or a preview window.
  const replies = await Promise.all(Array.from({length: 20}, () => session.command('HIDE', [], 6000)));
  assert.deepEqual(replies, Array(20).fill('HIDDEN'));
  assert.equal(children.size, 1);
  assert.equal(await session.command('PING'), 'PONG');
  await session.stop();
  for (const child of children.values()) { await child.closed; assert.equal(child.exitCode, 0); }
  assert.equal(timers.size, 0);
  assert.equal(await session.command('HIDE'), 'HIDDEN');
  assert.equal(children.size, 2);
  await session.dispose();
  for (const child of children.values()) {
    await child.closed;
    assert.equal(child.exitCode, 0);
    assert.equal(child.stdout.listenerCount('data'), 0);
    assert.equal(child.listenerCount('error'), 0);
  }
  assert.equal(timers.size, 0);
  await assert.rejects(session.command('PING'), {code: 'NATIVE_PREVIEW_HOST_EXITED'});
  console.log('PASS native C# preview host: one parallel startup, PONG/HIDDEN, graceful restart/disposal, no owned timers');
} finally {
  await session.dispose();
  for (const child of children.values()) { if (child.exitCode === null && !child.killed) child.kill(); await child.closed; }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {createFileLockOwner} from '../netunim-orders/document-bridge/file-lock-owner.mjs';
import {createFileLockPlatform} from '../netunim-orders/document-bridge/file-lock-platform.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'netunim-file-lock-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const locks = createFileLockOwner({...createFileLockPlatform({root}), clock: () => performance.now(), wait: ms => new Promise(resolve => setTimeout(resolve, ms))});
  return {root, locks, lockPath: path.join(root, 'index.lock')};
}
function worker(t, root, label, waitMs = 10000) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/file_lock_process_worker.mjs', import.meta.url)), root, label, String(waitMs)], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc']});
  const messages = [], waiters = []; let stderr = '';
  child.stderr.on('data', bytes => { stderr += bytes.toString(); });
  child.on('message', message => { messages.push(message); for (const wake of waiters.splice(0)) wake(); });
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)); });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; });
  async function receive(kind) {
    let timer;
    try { return await Promise.race([new Promise(resolve => {
      const inspect = () => { const message = messages.find(row => row.kind === kind); if (message) resolve(message); else waiters.push(inspect); }; inspect();
    }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`worker ${label} missing ${kind}: ${stderr}`)), 12000); })]); }
    finally { clearTimeout(timer); }
  }
  return {child, receive, exited};
}

test('production lock composition preserves an aged live legacy owner on native disk', async t => {
  const f = await fixture(t); await fs.mkdir(f.lockPath);
  const ownerBytes = JSON.stringify({pid: process.pid, startedAt: '2000-01-01T00:00:00Z'});
  await fs.writeFile(path.join(f.lockPath, 'owner.json'), ownerBytes); await fs.utimes(f.lockPath, new Date(0), new Date(0));
  const source = await fs.readFile(new URL('../netunim-orders/document-bridge/server.mjs', import.meta.url), 'utf8');
  const declarations = parse(source, {ecmaVersion: 'latest', sourceType: 'module'}).body.filter(node => node.type === 'VariableDeclaration' && node.declarations.some(row => ['fileLocks', 'withFileLock'].includes(row.id.name)));
  const run = vm.runInNewContext(declarations.map(node => source.slice(node.start, node.end)).join('\n') + '\nwithFileLock', {createFileLockOwner, createFileLockPlatform, APP_ROOT: f.root, performance, setTimeout});
  let entered = false;
  await assert.rejects(run(f.lockPath, async () => { entered = true; }, {waitMs: 0}), {code: 'FILE_LOCK_TIMEOUT'});
  assert.equal(entered, false); assert.equal(await fs.readFile(path.join(f.lockPath, 'owner.json'), 'utf8'), ownerBytes);
});

test('real live child excludes a contender regardless of lock age and drains before successor', async t => {
  const f = await fixture(t), first = worker(t, f.root, 'first'); await first.receive('entered');
  await fs.utimes(f.lockPath, new Date(0), new Date(0));
  const original = await fs.readFile(path.join(f.lockPath, 'owner.json'), 'utf8'), blocked = worker(t, f.root, 'blocked', 0);
  assert.equal((await blocked.receive('failed')).code, 'FILE_LOCK_TIMEOUT'); assert.equal(await blocked.exited, 1);
  assert.equal(await fs.readFile(path.join(f.lockPath, 'owner.json'), 'utf8'), original);
  first.child.send('release'); await first.receive('done'); assert.equal(await first.exited, 0);
  const successor = worker(t, f.root, 'successor'); await successor.receive('entered'); successor.child.send('release'); await successor.receive('done'); assert.equal(await successor.exited, 0);
  assert.equal(await fs.readFile(path.join(f.root, 'effects.txt'), 'utf8'), 'first\nsuccessor\n');
  assert.deepEqual((await fs.readdir(f.root)).filter(name => name.includes('.lock')), []);
});

test('two native contenders serialize recovery after the original process dies', async t => {
  const f = await fixture(t), dead = worker(t, f.root, 'dead'); await dead.receive('entered'); dead.child.kill('SIGKILL'); await dead.exited;
  const a = worker(t, f.root, 'a'), b = worker(t, f.root, 'b');
  const first = await Promise.race([a.receive('entered').then(() => a), b.receive('entered').then(() => b)]);
  const second = first === a ? b : a;
  const owner = JSON.parse(await fs.readFile(path.join(f.lockPath, 'owner.json'), 'utf8')); assert.equal(owner.pid, first.child.pid);
  first.child.send('release'); await first.receive('done'); await first.exited;
  await second.receive('entered'); second.child.send('release'); await second.receive('done'); await second.exited;
  const effects = (await fs.readFile(path.join(f.root, 'effects.txt'), 'utf8')).trim().split('\n');
  assert.equal(effects.length, 3); assert.deepEqual(effects.slice(1).sort(), ['a', 'b']);
  assert.deepEqual((await fs.readdir(f.root)).filter(name => name.includes('.lock')), []);
});

test('native malformed/ownerless metadata and foreign same-PID replacements are preserved', async t => {
  const f = await fixture(t); await fs.mkdir(f.lockPath);
  for (const text of ['', '{bad', JSON.stringify({pid: true})]) {
    await fs.writeFile(path.join(f.lockPath, 'owner.json'), text);
    await assert.rejects(f.locks.run(f.lockPath, async () => 1, {waitMs: 0}), {code: 'FILE_LOCK_OWNER_UNCERTAIN'});
    await assert.rejects(f.locks.isHeld(f.lockPath), {code: 'FILE_LOCK_OWNER_UNCERTAIN'});
    assert.equal(await fs.readFile(path.join(f.lockPath, 'owner.json'), 'utf8'), text);
  }
  await fs.unlink(path.join(f.lockPath, 'owner.json')); await fs.rmdir(f.lockPath);
  const replacement = JSON.stringify({pid: process.pid, token: 'foreign', startedAt: 'replacement'});
  await assert.rejects(f.locks.run(f.lockPath, async () => { await fs.writeFile(path.join(f.lockPath, 'owner.json'), replacement); }), {code: 'FILE_LOCK_RELEASE_FAILED'});
  assert.equal(await fs.readFile(path.join(f.lockPath, 'owner.json'), 'utf8'), replacement);
});

test('native adapter rejects out-of-root targets before filesystem mutation', async t => {
  const f = await fixture(t), platform = createFileLockPlatform({root: f.root});
  for (const invalid of [f.root, path.join(f.root, '..', 'outside.lock'), path.join(f.root, 'nested', 'index.lock')]) {
    await assert.rejects(platform.files.create(invalid), {code: 'FILE_LOCK_PATH_UNSAFE'}); await assert.rejects(platform.files.removeDirectory(invalid), {code: 'FILE_LOCK_PATH_UNSAFE'});
  }
  assert.deepEqual(await fs.readdir(f.root), []);
});

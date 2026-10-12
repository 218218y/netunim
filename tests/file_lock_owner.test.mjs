import test from 'node:test';
import assert from 'node:assert/strict';
import {createFileLockOwner} from '../netunim-orders/document-bridge/file-lock-owner.mjs';
import {fixture, deferred} from './file_lock_fixture.mjs';
test('owned work completes and releases only its own metadata and directory', async () => {
  const f = fixture(); assert.equal(await f.owner.run('lock', async () => 'committed'), 'committed'); assert.equal(f.directories.size, 0);
});
test('a live legacy or current owner cannot be replaced by elapsed time', async () => {
  for (const token of [null, 'current']) {
    const f = fixture(), current = {pid: 11, token, startedAt: 'ancient'}; f.directories.set('lock', current);
    let entered = false;
    await assert.rejects(f.owner.run('lock', async () => { entered = true; }, {waitMs: 100000}), {code: 'FILE_LOCK_TIMEOUT'});
    assert.equal(entered, false); assert.equal(f.directories.get('lock'), current);
  }
});
test('ownerless reservations are retained instead of being expired', async () => {
  const f = fixture(); f.directories.set('lock', null);
  await assert.rejects(f.owner.run('lock', async () => 'must not enter', {waitMs: 0}), {code: 'FILE_LOCK_OWNER_UNCERTAIN'});
  await assert.rejects(f.owner.isHeld('lock'), {code: 'FILE_LOCK_OWNER_UNCERTAIN'}); assert.equal(f.directories.has('lock'), true);
});
test('a proven dead legacy owner is reclaimed once through a serialized gate', async () => {
  const f = fixture(); f.directories.set('lock', {pid: 22, token: null, startedAt: null});
  assert.equal(await f.owner.isHeld('lock'), false);
  assert.equal(await f.owner.run('lock', async () => 7, {waitMs: 0}), 7); assert.equal(f.directories.size, 0);
});
test('a reaper observes a live replacement afresh after winning the gate', async () => {
  const f = fixture(), create = f.ports.files.create;
  f.directories.set('lock', {pid: 22, token: 'dead', startedAt: 'old'});
  f.ports.files.create = async path => {
    const result = await create(path);
    if (path.endsWith('.reclaim') && result) f.directories.set('lock', {pid: 11, token: 'replacement', startedAt: 'new'});
    return result;
  };
  await assert.rejects(createFileLockOwner(f.ports).run('lock', async () => 'must not enter', {waitMs: 0}), {code: 'FILE_LOCK_TIMEOUT'});
  assert.equal(f.directories.get('lock').token, 'replacement'); assert.equal(f.directories.has('lock.reclaim'), false);
});
test('an existing reaper gate is never expired or recursively reclaimed', async () => {
  const f = fixture(); f.directories.set('lock', {pid: 22, token: 'dead', startedAt: 'old'}); f.directories.set('lock.reclaim', null);
  await assert.rejects(f.owner.run('lock', async () => 1, {waitMs: 0}), {code: 'FILE_LOCK_RECLAIM_BLOCKED'});
  assert.equal(f.directories.get('lock').token, 'dead'); assert.equal(f.directories.has('lock.reclaim'), true);
});
test('uncertain liveness cannot authorize takeover', async () => {
  const f = fixture(), denied = Object.assign(new Error('probe unavailable'), {code: 'EACCES'});
  f.directories.set('lock', {pid: 22, token: 'retained', startedAt: 'old'}); f.ports.owners.alive = async () => { throw denied; };
  await assert.rejects(createFileLockOwner(f.ports).run('lock', async () => 1, {waitMs: 0}), denied); assert.equal(f.directories.get('lock').token, 'retained');
});
test('lost ownership before task entry prevents work and leaves the replacement intact', async () => {
  const f = fixture(), write = f.ports.files.writeOwner;
  f.ports.files.writeOwner = async (path, owner) => { await write(path, owner); f.directories.set(path, {pid: 11, token: 'foreign', startedAt: 'new'}); };
  let entered = false;
  await assert.rejects(createFileLockOwner(f.ports).run('lock', async () => { entered = true; }), {code: 'FILE_LOCK_RELEASE_FAILED'});
  assert.equal(entered, false); assert.equal(f.directories.get('lock').token, 'foreign');
});
test('an old finally cannot remove a same-PID replacement after started work', async () => {
  const f = fixture();
  await assert.rejects(f.owner.run('lock', async () => { f.directories.set('lock', {pid: 11, token: 'foreign', startedAt: 'new'}); return 'old commit'; }), {code: 'FILE_LOCK_RELEASE_FAILED'});
  assert.equal(f.directories.get('lock').token, 'foreign');
});
test('task failures retain their original code when cleanup succeeds', async () => {
  const f = fixture(), original = Object.assign(new Error('journal invalid'), {code: 'PDF_INDEX_JOURNAL_INVALID'});
  await assert.rejects(f.owner.run('lock', async () => { throw original; }), original); assert.equal(f.directories.size, 0);
});
test('cleanup failures block success and retain both errors if the task also failed', async () => {
  const f = fixture(), original = new Error('task failed'), cleanup = Object.assign(new Error('unlink failed'), {code: 'EIO'});
  f.ports.files.removeOwner = async () => { throw cleanup; };
  await assert.rejects(createFileLockOwner(f.ports).run('lock', async () => { throw original; }), error => {
    assert.equal(error.code, 'FILE_LOCK_RELEASE_FAILED'); assert.deepEqual(error.errors, [original, cleanup]); return true;
  });
  assert.equal(f.directories.has('lock'), true);
});
test('initialization failures never start work and retain partial metadata', async () => {
  const f = fixture(), error = Object.assign(new Error('partial write'), {code: 'EIO'});
  f.ports.files.writeOwner = async path => { f.directories.set(path, {pid: 11, token: null, startedAt: null}); throw error; };
  let entered = false;
  await assert.rejects(createFileLockOwner(f.ports).run('lock', async () => { entered = true; }), error);
  assert.equal(entered, false); assert.equal(f.directories.has('lock'), true);
});
test('started work drains before release and competing work cannot enter early', async () => {
  const f = fixture(), pending = deferred(), entered = deferred();
  const first = f.owner.run('lock', async () => { entered.resolve(); return pending.promise; }); await entered.promise;
  await assert.rejects(f.owner.run('lock', async () => 'second', {waitMs: 0}), {code: 'FILE_LOCK_TIMEOUT'});
  assert.equal(f.directories.has('lock'), true); pending.resolve('durable'); assert.equal(await first, 'durable'); assert.equal(f.directories.size, 0);
});
test('100 cycles release all claim/reaper resources and preserve repeated task outputs', async () => {
  const f = fixture();
  for (let cycle = 0; cycle < 100; cycle++) {
    f.directories.set('lock', {pid: 22, token: `dead-${cycle}`, startedAt: 'old'});
    assert.equal(await f.owner.run('lock', async () => cycle), cycle); assert.equal(f.directories.size, 0);
  }
});
test('invalid ports, owners and wait budgets fail before work', async () => {
  assert.throws(() => createFileLockOwner({}), /file_lock_ports_required/);
  const f = fixture();
  for (const waitMs of [-1, NaN, Infinity]) await assert.rejects(f.owner.run('lock', async () => 1, {waitMs}), /file_lock_request_required/);
  f.ports.owners.next = () => ({pid: 0, token: '', startedAt: ''});
  await assert.rejects(createFileLockOwner(f.ports).run('lock', async () => 1), /file_lock_owner_required/); assert.equal(f.directories.size, 0);
});

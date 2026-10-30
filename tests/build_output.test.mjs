import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {withBuildOutput} from '../tools/build-output.mjs';

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'netunim-build-output-'));
  try {await run(root)} finally {
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('netunim-build-output-'));
    await fs.rm(root, {recursive: true, force: true});
  }
}

async function content({out, privateDir}, value) {
  await fs.writeFile(path.join(out, 'index.html'), value);
  await fs.writeFile(path.join(privateDir, 'manifest.json'), value);
}

test('failed compilation preserves the last verified public/private output', () => fixture(async root => {
  await withBuildOutput(root, 'orders', stage => content(stage, 'verified'));
  await assert.rejects(withBuildOutput(root, 'orders', async stage => {
    await content(stage, 'incomplete');
    throw Error('intentional validation failure');
  }), /intentional validation failure/);
  assert.equal(await fs.readFile(path.join(root, 'dist/orders/index.html'), 'utf8'), 'verified');
  assert.equal(await fs.readFile(path.join(root, '.work/production/orders/manifest.json'), 'utf8'), 'verified');
  assert.deepEqual(await fs.readdir(path.join(root, '.work/build-staging')), []);
  assert.deepEqual(await fs.readdir(path.join(root, '.work/build-locks')), []);
}));

test('a second build cannot overwrite an in-flight build for the same app', () => fixture(async root => {
  let release, entered;
  const pending = new Promise(resolve => {release = resolve});
  const began = new Promise(resolve => {entered = resolve});
  const first = withBuildOutput(root, 'kupa', async stage => {entered(); await pending; await content(stage, 'first')});
  await began;
  await assert.rejects(withBuildOutput(root, 'kupa', stage => content(stage, 'second')), /already locked/);
  release(); await first;
  assert.equal(await fs.readFile(path.join(root, 'dist/kupa/index.html'), 'utf8'), 'first');
}));

test('a publication failure restores the original public output', () => fixture(async root => {
  await withBuildOutput(root, 'orders', stage => content(stage, 'verified'));
  const privateDir = path.join(root, '.work/production/orders');
  await fs.rm(privateDir, {recursive: true});
  await fs.writeFile(privateDir, 'blocked target');
  await assert.rejects(withBuildOutput(root, 'orders', stage => content(stage, 'new')), /Unsafe output directory/);
  assert.equal(await fs.readFile(path.join(root, 'dist/orders/index.html'), 'utf8'), 'verified');
  assert.equal(await fs.readFile(privateDir, 'utf8'), 'blocked target');
}));

test('linked output parents are refused before any write through them', () => fixture(async root => {
  const external = path.join(root, 'external'); await fs.mkdir(external);
  const workspace = path.join(root, 'workspace'); await fs.mkdir(workspace);
  await fs.symlink(external, path.join(workspace, 'dist'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(withBuildOutput(workspace, 'orders', stage => content(stage, 'wrong')), /real directory/);
  assert.deepEqual(await fs.readdir(external), []);
}));

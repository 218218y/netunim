import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {auditAssets} from '../tools/build-asset-references.mjs';

test('emitted asset closure catches relocated modules, classic workers and vendor CSS dependencies', async () => {
  const site = await fs.mkdtemp(path.join(os.tmpdir(), 'netunim-asset-closure-'));
  const files = {'index.html': '<script src="./assets/build/app.js"></script>',
    'assets/build/app.js': 'import "./chunk.js";new Worker(new URL("./worker.js",import.meta.url));',
    'assets/build/chunk.js': 'export const ready=true;',
    'assets/build/worker.js': 'importScripts("../vendor/runtime.js");',
    'assets/vendor/runtime.js': '/* integrity-pinned classic library */',
    'assets/vendor/viewer.css': 'a{background:url("images/icon.svg")}b{background:url(data:image/svg+xml;base64,AA==)}',
    'assets/vendor/images/icon.svg': '<svg/>'};
  try {
    for (const [name, source] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(site, name)), {recursive: true});
      await fs.writeFile(path.join(site, name), source);
    }
    const result = await auditAssets(site);
    assert.deepEqual(new Set(result.references.map(row => row.kind)), new Set(['html', 'module', 'worker', 'classic-worker-script', 'css']));
    for (const name of ['assets/build/chunk.js', 'assets/build/worker.js', 'assets/vendor/runtime.js', 'assets/vendor/images/icon.svg']) {
      await fs.unlink(path.join(site, name));
      await assert.rejects(auditAssets(site), /Missing .* reference/);
      await fs.writeFile(path.join(site, name), files[name]);
    }
    await fs.writeFile(path.join(site, 'assets/build/app.js'), 'import "./CHUNK.js";');
    await assert.rejects(auditAssets(site), /Missing module reference/, 'Case mismatches must fail on Windows too');
  } finally {
    assert.equal(path.dirname(site), os.tmpdir());
    assert.ok(path.basename(site).startsWith('netunim-asset-closure-'));
    await fs.rm(site, {recursive: true, force: true});
  }
});

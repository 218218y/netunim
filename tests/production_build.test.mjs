import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT, buildApp} from '../tools/production-build.mjs';
import {graph} from '../tools/build-graph.mjs';

test('production payloads are deterministic, gated and independently verified', {timeout: 300000}, async () => {
  for (const app of ['orders', 'kupa']) {
    await buildApp(app);
    const manifestPath = path.join(ROOT, '.work/production', app, 'manifest.json');
    const first = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    await buildApp(app);
    assert.deepEqual(JSON.parse(await fs.readFile(manifestPath, 'utf8')), first);
    const site = path.join(ROOT, 'dist', app);
    const html = await fs.readFile(path.join(site, 'index.html'), 'utf8');
    const entry = html.match(/<script type="module" src="\.\/([^\"]+)"/)[1];
    const builtGraph = await graph(site, entry);
    const staticNames = new Set();
    function collect(name) {
      if (staticNames.has(name)) return;
      staticNames.add(name);
      builtGraph.modules[name].static.forEach(collect);
    }
    collect(entry);
    const metadata = JSON.parse(await fs.readFile(path.join(ROOT, '.work/production', app, 'metafile.json'), 'utf8'));
    for (const [output, row] of Object.entries(metadata.outputs)) {
      const relative = path.relative(site, path.resolve(ROOT, `netunim-${app}/site`, output)).split(path.sep).join('/');
      if (!staticNames.has(relative)) continue;
      assert.ok(Object.keys(row.inputs).every(input => ['assets/app.js', 'assets/js/shared/app-release-startup.js'].includes(input)), 'Business module entered pre-approval graph');
    }
    assert.equal(Object.keys(first.files).some(name => name.endsWith('.map')), false);
    assert.equal(Object.keys(first.files).some(name => name.endsWith('/main.js')), false);
    const target = path.join(site, entry);
    const original = await fs.readFile(target);
    await fs.appendFile(target, '\n// tampered\n');
    const result = spawnSync('python', ['tools/verify-build.py', app], {cwd: ROOT, encoding: 'utf8'});
    assert.notEqual(result.status, 0, 'Mutated production payload passed');
    await fs.writeFile(target, original);
    for (const action of [['prepare', app], ['verify', app, first.release]]) {
      const receipt = spawnSync('python', ['tools/deployment-receipt.py', ...action], {cwd: ROOT, encoding: 'utf8'});
      assert.equal(receipt.status, 0, receipt.stderr);
    }
    const retained = path.join(ROOT, '.work/releases', app, first.release, 'site', entry);
    await fs.appendFile(retained, '\n// damaged rollback artifact\n');
    const rollback = spawnSync('python', ['tools/deployment-receipt.py', 'verify', app, first.release], {cwd: ROOT, encoding: 'utf8'});
    assert.notEqual(rollback.status, 0, 'Damaged rollback artifact passed verification');
    await fs.writeFile(retained, original);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { bankStage } from './bank_stage_fixture.mjs';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const [label, module, endpoint, document, anchor, replacement] of [
  [
    'artifact read',
    'bridge-artifacts.mjs',
    '/bank/diagnostics',
    'bank-latest.json',
    "return JSON.parse(await files.readFile(candidate, 'utf8'));",
    "const value=JSON.parse(await files.readFile(candidate,'utf8'));await files.writeFile(path.join(directory,'fixture-read-completed'),'completed');return value;",
  ],
  [
    'diagnostic summary',
    'credit-diagnostic-log.mjs',
    '/credit/diagnostics',
    'credit-diagnostics.jsonl',
    "const content = await fs.readFile(file, 'utf8');",
    "const content=await fs.readFile(file,'utf8');await fs.writeFile(path.join(directory,'fixture-read-completed'),'completed');",
  ],
])
  test(
    'native shutdown retains an accepted ' + label + ' after its HTTP client disconnects',
    { timeout: 15000 },
    async (t) => {
      const f = await bankStage(t, {
        prepare: async ({ runtime, app }) => {
          const diagnostics = path.join(app, 'diagnostics');
          await fs.mkdir(diagnostics);
          await fs.writeFile(
            path.join(diagnostics, document),
            JSON.stringify({
              profileId: 'native-artifact-fixture',
              schemaVersion: 3,
              stage: 'Fixture',
            }) + '\n'
          );
          const filename = path.join(runtime, module),
            source = await fs.readFile(filename, 'utf8');
          assert.ok(source.includes(anchor));
          const adapter = module === 'bridge-artifacts.mjs' ? 'files' : 'fs';
          const held = `await ${adapter}.writeFile(path.join(directory,'fixture-read-entered'),'entered');
      while(true){try{await ${adapter}.access(path.join(directory,'fixture-read-release'));break}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(resolve=>setTimeout(resolve,10))}};
      `;
          await fs.writeFile(filename, source.replace(anchor, held + replacement));
        },
      });
      const reading = http.request(
        f.base + endpoint,
        { agent: false, headers: { Authorization: 'Bearer native-fixture-token' } },
        (response) => response.resume()
      );
      reading.on('error', () => {});
      reading.end();
      const directory = module === 'bridge-artifacts.mjs' ? f.app : path.join(f.app, 'diagnostics'),
        deadline = Date.now() + 5000;
      while (true) {
        try {
          await fs.access(path.join(directory, 'fixture-read-entered'));
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          if (Date.now() > deadline) throw new Error('artifact read did not enter: ' + f.output());
          await pause(10);
        }
      }
      const disconnected = new Promise((resolve) => reading.once('close', resolve));
      reading.destroy();
      await disconnected;
      try {
        assert.deepEqual(await (await f.request('/shutdown', { method: 'POST' })).json(), {
          ok: true,
        });
        assert.equal(
          await Promise.race([f.exited.then(() => true), pause(150).then(() => false)]),
          false,
          'accepted artifact reads must finish before normal process exit'
        );
        assert.equal((await f.request('/health')).status, 200);
        assert.equal((await (await f.request(endpoint)).json()).code, 'BRIDGE_STOPPING');
      } finally {
        await fs.writeFile(path.join(directory, 'fixture-read-release'), 'release');
      }
      assert.equal((await f.exited)[0], 0, f.output());
      assert.equal(
        await fs.readFile(path.join(directory, 'fixture-read-completed'), 'utf8'),
        'completed'
      );
    }
  );

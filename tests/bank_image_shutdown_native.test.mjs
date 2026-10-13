import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { bankStage } from './bank_stage_fixture.mjs';
import { PNG } from './bank_file_fixture.mjs';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  'native shutdown retains an accepted image read after its HTTP client disconnects',
  { timeout: 15000 },
  async (t) => {
    const key = 'b'.repeat(64);
    const f = await bankStage(t, {
      prepare: async ({ runtime, app }) => {
        const directory = path.join(app, 'cheque-image-cache');
        await fs.mkdir(directory);
        await fs.writeFile(path.join(directory, key + '.bin'), PNG);
        await fs.writeFile(
          path.join(directory, key + '.json'),
          JSON.stringify({
            schemaVersion: 1,
            key,
            size: PNG.length,
            contentType: 'image/png',
            eventDate: '20261013',
          })
        );
        const file = path.join(runtime, 'cheque-images.mjs'),
          source = await fs.readFile(file, 'utf8');
      const anchor = 'const [metaText, data] = await joinFileAttempts([';
        assert.ok(source.includes(anchor));
        const held = `await fs.writeFile(path.join(directory,'fixture-read-entered'),'entered');
      while(true){try{await fs.access(path.join(directory,'fixture-read-release'));break}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(resolve=>setTimeout(resolve,10))}}
      `;
        const completion = 'contentType = supportedImageType(data, meta?.contentType);';
        assert.ok(source.includes(completion));
        await fs.writeFile(
          file,
          source
            .replace(anchor, held + anchor)
            .replace(
              completion,
              completion +
                "await fs.writeFile(path.join(directory,'fixture-read-completed'),'completed');"
            )
        );
      },
    });
    const reading = http.request(
      f.base + '/bank/cheque-image/' + key,
      { agent: false, headers: { Authorization: 'Bearer native-fixture-token' } },
      (response) => response.resume()
    );
    reading.on('error', () => {});
    reading.end();
    const directory = path.join(f.app, 'cheque-image-cache'),
      deadline = Date.now() + 5000;
    while (true) {
      try {
        await fs.access(path.join(directory, 'fixture-read-entered'));
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (Date.now() > deadline) throw new Error('image read did not enter: ' + f.output());
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
        'HTTP socket closure must not abandon an accepted file job'
      );
      assert.equal((await f.request('/health')).status, 200);
      assert.equal(
        (await (await f.request('/bank/cheque-image/' + key)).json()).code,
        'BRIDGE_STOPPING'
      );
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

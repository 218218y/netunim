import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { bankStage } from './bank_stage_fixture.mjs';

test(
  'native staged Credit composition retains adapter cleanup before status and diagnostic publication',
  { timeout: 30000 },
  async (t) => {
    const f = await bankStage(t, {
      prepare: async ({ runtime }) => {
        await fs.copyFile(
          new URL('./fixtures/credit_adapter_runtime.mjs', import.meta.url),
          path.join(runtime, 'fixture-credit-scrapers.mjs')
        );
        const file = path.join(runtime, 'server.mjs'),
          source = await fs.readFile(file, 'utf8');
        const locate = /findInstalled:\s*browserLocator\.find/,
          load = /loadScrapers:\s*\(\)\s*=>\s*import\('israeli-bank-scrapers'\)/,
          vault =
            'const vault=createConnectionVault({directory:APP_DIR,protectText,unprotectText});';
        assert.ok(locate.test(source));
        assert.ok(load.test(source));
        assert.ok(source.includes(vault));
        assert.ok(source.includes('createAdapter:createCreditProviderAdapter'));
        await fs.writeFile(
          file,
          source
            .replace(locate, "findInstalled:async()=> 'fixture-browser'")
            .replace(load, "loadScrapers:()=>import('./fixture-credit-scrapers.mjs')")
            .replace(
              vault,
              "const vault={...createConnectionVault({directory:APP_DIR,protectText,unprotectText}),readCreditProfiles:async()=>[{profileId:'fixture-max',provider:'max',active:true,label:'Synthetic credit',credentials:{password:' exact synthetic secret '}}]};"
            )
            .replace(
              'createAdapter:createCreditProviderAdapter',
              "createAdapter:options=>createCreditProviderAdapter({...options,now:()=>new Date('2026-10-13T12:00:00Z')})"
            )
        );
      },
    });
    const reading = f.request('/credit/sync', { method: 'POST', body: { syncMode: 'quick' } }),
      deadline = Date.now() + 10000;
    let completed = false;
    void reading.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      }
    );
    try {
      while (true) {
        try {
          await fs.access(path.join(f.app, 'fixture-credit-terminate-entered'));
          break;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          if (Date.now() > deadline)
            throw new Error('credit adapter did not reach cleanup: ' + f.output());
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      assert.equal(completed, false);
      assert.equal(
        (await (await f.request('/credit/reset', { method: 'POST' })).json()).code,
        'SCRAPE_BUSY'
      );
      await assert.rejects(
        fs.access(path.join(f.app, 'credit-status.json')),
        (error) => error.code === 'ENOENT'
      );
      await assert.rejects(
        fs.access(path.join(f.app, 'diagnostics', 'credit-data-latest.json')),
        (error) => error.code === 'ENOENT'
      );
    } finally {
      await fs.writeFile(path.join(f.app, 'fixture-credit-terminate-release'), 'release');
    }
    const response = await reading;
    assert.equal(response.status, 200, f.output());
    const result = await response.json();
    assert.equal(result.profiles.length, 1);
    assert.equal(result.errors.length, 0);
    const profile = result.profiles[0],
      account = profile.accounts[0];
    assert.equal(profile.coreComplete, true);
    assert.equal(account.accountNumber, '0042');
    assert.equal(account.balance, -25);
    assert.deepEqual(
      account.months.map((row) => row.month),
      ['2026-09', '2026-10', '2026-11']
    );
    assert.equal(
      account.months.find((row) => row.month === '2026-10').transactions[0].chargedAmount,
      -25
    );
    assert.equal(result._dataDiagnostics, undefined);
    assert.ok(!JSON.stringify(result).includes('rawTransaction'));
    assert.ok(!JSON.stringify(result).includes('synthetic secret'));
    const status = await (await f.request('/credit/status')).json();
    assert.equal(status.lastSyncAt, result.syncedAt);
    const events = (await fs.readFile(path.join(f.app, 'fixture-credit-trace.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.deepEqual(
      events.filter((row) => row.stage !== 'request').map((row) => row.stage),
      ['initialize', 'login', 'terminate', 'terminated']
    );
    assert.equal(events[0].futureMonths, 1);
    assert.equal(events.at(-2).success, true);
    assert.equal(events.filter((row) => row.stage === 'request').length, 5);
    await fs.access(path.join(f.app, 'diagnostics', 'credit-data-latest.json'));
    assert.deepEqual(await (await f.request('/shutdown', { method: 'POST' })).json(), { ok: true });
    assert.equal((await f.exited)[0], 0, f.output());
  }
);

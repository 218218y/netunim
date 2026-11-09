import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {buildEnvironment, stagingConfiguration, stagingConfigSource, stagingHeaders} from '../tools/build-environment.mjs';

const config = JSON.parse(await fs.readFile(new URL('../config/staging-supabase.json', import.meta.url), 'utf8'));
const evaluate = (source, hostname) => vm.runInNewContext(source.replace('export const supabaseConfig =', 'globalThis.result =') + '\nresult', {location:{hostname}});
test('Preview builds select staging and cannot opt into production; invalid environments fail closed', () => {
  assert.equal(buildEnvironment({}), 'production');
  assert.equal(buildEnvironment({CF_PAGES_BRANCH:'main'}), 'production');
  assert.equal(buildEnvironment({CF_PAGES_BRANCH:'feature/security'}), 'staging');
  assert.equal(buildEnvironment({NETUNIM_BUILD_ENV:'staging'}), 'staging');
  assert.throws(() => buildEnvironment({CF_PAGES_BRANCH:'preview', NETUNIM_BUILD_ENV:'production'}));
  assert.throws(() => buildEnvironment({NETUNIM_BUILD_ENV:'prodution'}));
  for (const bad of [{...config, url:'https://bupoidcurcxuypfrjqio.supabase.co'},
    {...config, url:config.url + '/extra'}, {...config, publishableKey:'sb_secret_forbidden'},
    {...config, serviceRole:'forbidden'}]) assert.throws(() => stagingConfiguration(bad));
});
test('fresh staging bootstrap rejects production and changes only managed platform defaults', () => {
  const result = spawnSync('python', ['-c', `
import sys,json
from pathlib import Path
sys.path.insert(0,'tools')
from staging_bootstrap import portable_baseline,staging_project,ROOT,BASELINE
source=(ROOT/'supabase/migrations'/BASELINE).read_text(encoding='utf-8')
filtered=portable_baseline(source)
removed=[line for line in source.splitlines() if line not in filtered.splitlines()]
assert len(removed)==15 and all(line.startswith('ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin"') for line in removed)
assert '\\n'.join(line for line in source.splitlines() if line not in removed)=='\\n'.join(filtered.splitlines())
for bad in [source+'\\nALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "private" GRANT EXECUTE ON FUNCTIONS TO "anon";\\n',source.replace('IN SCHEMA "public" GRANT','IN SCHEMA "private" GRANT',1)]:
 try:portable_baseline(bad)
 except ValueError:pass
 else:raise AssertionError('Changed managed defaults silently accepted')
try:staging_project({'url':'https://bupoidcurcxuypfrjqio.supabase.co'})
except ValueError:pass
else:raise AssertionError('Production staging target accepted')
print('portable staging bootstrap verified')
`], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
});
for (const app of ['orders','kupa']) test(`${app}: production config denies preview and unknown public hosts; staging config stays isolated`, async () => {
  const source = await fs.readFile(new URL(`../netunim-${app}/site/supabase/config.js`, import.meta.url), 'utf8');
  for (const host of ['preview.bargig-orders.pages.dev', 'preview.bargig-kupa.pages.dev', 'untrusted.example']) {
    assert.equal(evaluate(source, host).url, '');
    assert.equal(evaluate(source, host).publishableKey, '');
    assert.equal(evaluate(stagingConfigSource(config), host).url, config.url);
  }
  for (const host of ['bargig-orders.pages.dev','bargig-kupa.pages.dev','bargig-furniture.com','orders.bargig-furniture.com','kupa.bargig-furniture.com','localhost','127.0.0.1']) {
    assert.equal(evaluate(source, host).url, 'https://bupoidcurcxuypfrjqio.supabase.co');
  }
  const headers = stagingHeaders(await fs.readFile(new URL(`../netunim-${app}/site/_headers`, import.meta.url), 'utf8'), config);
  assert.equal(headers.includes('bupoidcurcxuypfrjqio.supabase.co'), false);
  assert.ok(headers.includes(config.url));
});

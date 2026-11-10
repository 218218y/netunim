import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('every bank runtime dependency is exact and covered by one integrity-protected lockfile',()=>{
  const directory='netunim-kupa/bank-bridge/',manifest=JSON.parse(read(directory+'package.json')),lock=JSON.parse(read(directory+'package-lock.json'));
  assert.deepEqual(lock.packages[''].dependencies,manifest.dependencies);
  assert.equal(manifest.netunimRuntimeDependencies,undefined);
  for(const [name,version] of Object.entries(manifest.dependencies)){
    assert.match(version,/^(?:npm:puppeteer@)?\d+\.\d+\.\d+$/);
    assert.ok(lock.packages['node_modules/'+name],name);
  }
  for(const [name,item] of Object.entries(lock.packages))if(name){
    assert.match(item.resolved,/^https:\/\/registry\.npmjs\.org\//,name);
    assert.match(item.integrity,/^sha512-/,name);
  }
  assert.equal(manifest.overrides.puppeteer,'$puppeteer');
  assert.equal(lock.packages['node_modules/puppeteer'].version,'25.16.0');
  const installer=read(directory+'setup-bank-bridge.mjs');
  assert.match(installer,/node_modules\/npm\/bin\/npm-cli\.js/);
  assert.match(installer,/'ci', '--omit=dev', '--ignore-scripts'/);
  assert.doesNotMatch(installer,/'install',|--package-lock=false|--no-save/);
});
test('both Bridge installers use the same checksum-verified private Node runtime',()=>{
  const document=read('netunim-orders/document-bridge/install_node_runtime.ps1'),bank=read('netunim-kupa/bank-bridge/install_node_runtime.ps1');
  assert.equal(bank.replaceAll('\r\n','\n'),document.replaceAll('\r\n','\n'));
  assert.match(bank,/expectedArchiveSha256/);assert.match(bank,/expectedNodeSha256/);assert.match(bank,/Get-FileHash/);
  const directory='netunim-kupa/bank-bridge/';
  const setup=read(directory+'setup_bank_bridge.ps1'),start=read(directory+'start_bank_bridge.bat');
  assert.match(setup,/\$nodeInstaller -AppRoot \$appRoot -WithNpm/);
  assert.match(setup,/\$nodeInstaller -AppRoot \$appRoot -VerifyOnly/);
  assert.match(start,/"%NODE%" server\.mjs/);
  assert.doesNotMatch(read(directory+'rollback_bank_bridge.bat'),/where node/);
});

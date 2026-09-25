import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('orders site exposes a dedicated local-document scope and connects only to loopback bridge',()=>{
  const html=read('netunim-orders/site/index.html');
  const main=read('netunim-orders/site/assets/js/main.js');
  const client=read('netunim-orders/site/assets/js/domains/documents/bridge.js');
  const headers=read('netunim-orders/site/_headers');
  assert.match(html,/data-global-search-mode="documents"/);
  assert.match(html,/מסמכים במחשב/);
  assert.match(main,/createDomainsDocumentBridge/);
  assert.match(main,/documentBridge:domainsDocumentBridge/);
  assert.match(client,/http:\/\/127\.0\.0\.1:8766/);
  assert.match(headers,/connect-src[^\n]*http:\/\/127\.0\.0\.1:8766/);
});

test('document bridge installer is per-computer, pinned, bounded and supports verified offline ES install',()=>{
  const installer=read('netunim-orders/document-bridge/install_document_bridge.bat');
  const esInstaller=read('netunim-orders/document-bridge/install_es.ps1');
  const server=read('netunim-orders/document-bridge/server.mjs');
  assert.match(installer,/NetunimDocumentBridge/);
  assert.match(installer,/--configure/);
  assert.match(installer,/--doctor/);
  assert.match(installer,/install-es\.log/);
  assert.match(esInstaller,/1\.1\.0\.38/);
  assert.match(esInstaller,/5e0c70cbf4f694080c34aa7c6c745e606c16fe76a4b5423b93ebf9dc34274c99/);
  assert.match(esInstaller,/Get-FileHash[^\n]*SHA256/);
  assert.match(esInstaller,/Get-AuthenticodeSignature/);
  assert.match(esInstaller,/github\.com\/voidtools\/ES\/releases\/download/);
  assert.match(esInstaller,/www\.voidtools\.com/);
  assert.match(esInstaller,/ftp\.voidtools\.com/);
  assert.match(esInstaller,/TimeoutSec/);
  assert.match(esInstaller,/PSScriptRoot/);
  assert.match(esInstaller,/Downloads/);
  assert.match(server,/listen\(BRIDGE_PORT,'127\.0\.0\.1'/);
  assert.match(server,/CONFIG_PATH=path\.join\(APP_ROOT,'config\.json'\)/);
  assert.match(server,/TOKEN_PATH=path\.join\(APP_ROOT,'bridge-token\.txt'\)/);
});

test('document search uses content-only ES queries and browser open calls cannot submit arbitrary paths',()=>{
  const server=read('netunim-orders/document-bridge/server.mjs');
  const lib=read('netunim-orders/document-bridge/lib.mjs');
  assert.match(lib,/ext:pdf/);
  assert.match(lib,/content:/);
  assert.match(lib,/'-path',rootPath,'\/a-d',search/);
  assert.match(server,/body\.id/);
  assert.doesNotMatch(server,/body\.path/);
  assert.match(server,/pathInsideRoot\(row\.fullPath,root\.path\)/);
});

test('orders service worker contains the new document bridge client after asset synchronization',()=>{
  const sw=read('netunim-orders/site/service-worker.js');
  assert.match(sw,/\.\/assets\/js\/domains\/documents\/bridge\.js/);
});

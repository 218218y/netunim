import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('orders site exposes a dedicated local-file scope and connects only to loopback bridge',()=>{
  const html=read('netunim-orders/site/index.html');
  const main=read('netunim-orders/site/assets/js/main.js');
  const client=read('netunim-orders/site/assets/js/domains/documents/bridge.js');
  const headers=read('netunim-orders/site/_headers');
  assert.match(html,/data-global-search-mode="documents"/);
  assert.match(html,/קבצים במחשב/);
  assert.match(html,/תוכן קבצים/);
  assert.match(main,/createDomainsDocumentBridge/);
  assert.match(main,/documentBridge:domainsDocumentBridge/);
  assert.match(client,/http:\/\/127\.0\.0\.1:8766/);
  assert.match(headers,/connect-src[^\n]*http:\/\/127\.0\.0\.1:8766/);
});

test('document bridge installer auto-starts Everything in hidden background mode and keeps verified ES install',()=>{
  const installer=read('netunim-orders/document-bridge/install_document_bridge.bat');
  const esInstaller=read('netunim-orders/document-bridge/install_es.ps1');
  const server=read('netunim-orders/document-bridge/server.mjs');
  assert.match(installer,/--ensure-everything/);
  assert.match(installer,/background mode/);
  assert.match(installer,/--doctor/);
  assert.match(installer,/--check-running/);
  assert.match(installer,/--write-install-summary/);
  assert.match(installer,/notepad\.exe "%SUMMARY%"/);
  assert.match(esInstaller,/1\.1\.0\.38/);
  assert.match(esInstaller,/Get-FileHash[^\n]*SHA256/);
  assert.match(server,/findEverythingExecutable/);
  assert.match(server,/'-startup','-first-instance'/);
  assert.match(server,/voidtools\\\\Everything/);
  assert.match(server,/EVERYTHING_START/);
  assert.match(server,/probeEverything\(\{fresh:true,autoStart:true\}\)/);
  assert.match(server,/listen\(BRIDGE_PORT,'127\.0\.0\.1'/);
  assert.doesNotMatch(server,/\bfetch\s*\(/);
  assert.doesNotMatch(server,/process\.exit\(0\)/);
  assert.match(server,/INSTALLATION-LOG\.txt/);
});

test('PowerShell configurator stays code-page independent for Windows PowerShell 5.1',()=>{
  const bytes=fs.readFileSync(new URL('../netunim-orders/document-bridge/configure_document_bridge.ps1',import.meta.url));
  const source=bytes.toString('ascii');
  assert.equal([...bytes].some(byte=>byte>0x7f),false,'configure_document_bridge.ps1 must remain ASCII-only');
  assert.match(source,/function Decode-UiText/);
  assert.match(source,/Encoding\]::UTF8\.GetString/);
  assert.doesNotMatch(source,/[^\x00-\x7F]/);
});

test('local search supports all file types, keeps roots bounded and browser open cannot submit arbitrary paths',()=>{
  const server=read('netunim-orders/document-bridge/server.mjs');
  const lib=read('netunim-orders/document-bridge/lib.mjs');
  assert.match(lib,/content:/);
  assert.match(lib,/no-background-search:/);
  assert.doesNotMatch(lib,/return `ext:pdf/);
  assert.doesNotMatch(lib,/is-indexed-property:content no-background-search/);
  assert.match(lib,/buildNameQuery/);
  assert.match(lib,/'-path',rootPath,'\/a-d',String\(search\)/);
  assert.match(server,/body\.id/);
  assert.doesNotMatch(server,/body\.path/);
  assert.match(server,/pathInsideRoot\(row\.fullPath,root\.path\)/);
  assert.doesNotMatch(server,/endsWith\('\.pdf'\)/);
});

test('content indexing zero is diagnostic-only and does not fail installation',()=>{
  const server=read('netunim-orders/document-bridge/server.mjs');
  assert.match(server,/Content is not pre-indexed/);
  assert.match(server,/content: search will still work by reading files on demand/);
  assert.doesNotMatch(server,/totalIndexedContent===0\)\{fatal=true/);
});

test('orders service worker contains the document bridge client after asset synchronization',()=>{
  const sw=read('netunim-orders/site/service-worker.js');
  assert.match(sw,/\.\/assets\/js\/domains\/documents\/bridge\.js/);
});

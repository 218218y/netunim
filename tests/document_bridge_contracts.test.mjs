import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('orders site exposes content search plus direct Everything search over loopback bridge',()=>{
  const html=read('netunim-orders/site/index.html');
  const main=read('netunim-orders/site/assets/js/main.js');
  const client=read('netunim-orders/site/assets/js/domains/documents/bridge.js');
  const headers=read('netunim-orders/site/_headers');
  assert.match(html,/data-global-search-mode="documents"/);
  assert.match(html,/קבצים במחשב/);
  assert.match(html,/תוכן קבצים/);
  assert.match(html,/>Everything<\/button>/);
  assert.match(main,/createDomainsDocumentBridge/);
  assert.match(main,/documentBridge:domainsDocumentBridge/);
  assert.match(client,/http:\/\/127\.0\.0\.1:8766/);
  assert.match(client,/mode==='content'\?'content':'everything'/);
  assert.match(headers,/connect-src[^\n]*http:\/\/127\.0\.0\.1:8766/);
});

test('bridge searches the complete Everything index and forces Unicode ES transport',()=>{
  const installer=read('netunim-orders/document-bridge/install_document_bridge.bat');
  const server=read('netunim-orders/document-bridge/server.mjs');
  const lib=read('netunim-orders/document-bridge/lib.mjs');
  assert.match(installer,/--ensure-everything/);
  assert.doesNotMatch(installer,/configure_document_bridge\.ps1/);
  assert.match(server,/scope=everything-index/);
  assert.doesNotMatch(server,/config\.roots/);
  assert.doesNotMatch(server,/pathInsideRoot/);
  assert.match(lib,/'-argv','-cp','65001','-ipc3'/);
  assert.match(lib,/'-search',String\(search\)/);
  assert.doesNotMatch(lib,/'-path',rootPath/);
  assert.match(server,/probeEverything\(\{fresh:true,autoStart:true\}\)/);
  assert.match(server,/listen\(BRIDGE_PORT,'127\.0\.0\.1'/);
});

test('file opening waits for Windows shell launch instead of fire-and-forget rundll32',()=>{
  const server=read('netunim-orders/document-bridge/server.mjs');
  assert.doesNotMatch(server,/rundll32\.exe/);
  assert.match(server,/Start-Process -FilePath \$env:NETUNIM_OPEN_TARGET/);
  assert.match(server,/explorer\.exe/);
  assert.match(server,/await fs\.stat\(row\.fullPath\)/);
  assert.match(server,/await appendLog\(`OPEN path=/);
  assert.match(server,/body\.id/);
  assert.doesNotMatch(server,/body\.path/);
});

test('installer keeps Everything hidden background startup and no longer asks for Bridge roots',()=>{
  const installer=read('netunim-orders/document-bridge/install_document_bridge.bat');
  const server=read('netunim-orders/document-bridge/server.mjs');
  assert.match(installer,/background mode/);
  assert.match(installer,/complete Everything index/i);
  assert.match(installer,/--doctor/);
  assert.match(installer,/--check-running/);
  assert.match(server,/'-startup','-first-instance'/);
  assert.match(server,/Search scope: complete Everything index/);
  assert.match(server,/COMPLETE EVERYTHING INDEX/);
});

test('PowerShell configurator remains code-page independent even though v4 no longer uses it during install',()=>{
  const bytes=fs.readFileSync(new URL('../netunim-orders/document-bridge/configure_document_bridge.ps1',import.meta.url));
  assert.equal([...bytes].some(byte=>byte>0x7f),false,'configure_document_bridge.ps1 must remain ASCII-only');
});

test('orders service worker contains the current document bridge client after asset synchronization',()=>{
  const sw=read('netunim-orders/site/service-worker.js');
  assert.match(sw,/\.\/assets\/js\/domains\/documents\/bridge\.js/);
});

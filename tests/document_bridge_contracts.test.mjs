import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('orders site exposes file search first and content search second over loopback bridge',()=>{
  const html=read('netunim-orders/site/index.html');
  const main=read('netunim-orders/site/assets/js/main.js');
  const client=read('netunim-orders/site/assets/js/domains/documents/bridge.js');
  const headers=read('netunim-orders/site/_headers');
  assert.match(html,/data-global-search-mode="documents"/);
  assert.match(html,/חיפוש במחשב/);
  assert.match(html,/globalSearchDocumentNameMode[\s\S]*חיפוש קבצים<\/button>[\s\S]*globalSearchDocumentContentMode[\s\S]*חיפוש תוכן<\/button>/);
  assert.match(html,/globalSearchDocumentNameMode[^>]*class="document-search-mode active"[^>]*aria-selected="true"/);
  assert.match(html,/globalSearchDocumentPreview/);
  assert.doesNotMatch(html,/globalSearchPreviewOpen/);
  assert.doesNotMatch(html,/globalSearchPreviewTitle|globalSearchPreviewMeta/);
  assert.match(html,/globalSearchPreviewMatches/);
  assert.match(main,/createDomainsDocumentBridge/);
  assert.match(main,/documentBridge:domainsDocumentBridge/);
  assert.match(client,/http:\/\/127\.0\.0\.1:8766/);
  assert.match(client,/mode==='content'\?'content':'everything'/);
  assert.match(client,/documents\/preview/);
  assert.match(client,/documents\/preview-file/);
  assert.match(client,/documents\/matches/);
  assert.match(client,/documents\/native-preview/);
  assert.match(client,/nativePreview/);
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
  assert.match(lib,/'--',String\(search\)/);
  assert.match(lib,/'-max-results',String\(count\)/);
  assert.doesNotMatch(lib,/'-search',String\(search\)/);
  assert.doesNotMatch(lib,/'-n',String\(count\)/);
  assert.doesNotMatch(lib,/'-path',rootPath/);
  assert.match(server,/probeEverything\(\{fresh:true,autoStart:true\}\)/);
  assert.match(server,/listen\(BRIDGE_PORT,'127\.0\.0\.1'/);
});

test('file and folder opening use the Windows graphical shell through UseShellExecute',()=>{
  const server=read('netunim-orders/document-bridge/server.mjs');
  assert.match(server,/System\.Diagnostics\.ProcessStartInfo/);
  assert.match(server,/UseShellExecute=\$true/);
  assert.match(server,/System\.Diagnostics\.Process\]::Start/);
  assert.doesNotMatch(server,/Shell\.Application; \$s\.Open/);
  assert.doesNotMatch(server,/execFile\('explorer\.exe'/);
  assert.match(server,/await fs\.stat\(row\.fullPath\)/);
  assert.match(server,/shell=UseShellExecute/);
  assert.match(server,/body\.id/);
  assert.doesNotMatch(server,/body\.path/);
});

test('preview stays local and Office uses the native Windows IPreviewHandler layer instead of Office automation',()=>{
  const server=read('netunim-orders/document-bridge/server.mjs');
  const lib=read('netunim-orders/document-bridge/lib.mjs');
  const ui=read('netunim-orders/site/assets/js/ui/global-search.js');
  const client=read('netunim-orders/site/assets/js/domains/documents/bridge.js');
  const installer=read('netunim-orders/document-bridge/install_document_bridge.bat');
  const build=read('netunim-orders/document-bridge/build_native_preview.ps1');
  const host=read('netunim-orders/document-bridge/native_preview_host.cs');
  assert.match(server,/documents\/preview/);
  assert.match(server,/documents\/preview-file/);
  assert.match(server,/documents\/matches/);
  assert.match(server,/documents\/native-preview/);
  assert.match(server,/NATIVE_PREVIEW_HOST/);
  assert.match(server,/source:'windows-preview-handler'/);
  assert.doesNotMatch(server,/OFFICE_PREVIEW_SCRIPT/);
  assert.doesNotMatch(server,/ensureOfficePreview/);
  assert.doesNotMatch(server,/source:'office-pdf'/);
  assert.match(lib,/officePreviewKind/);
  assert.match(lib,/buildEsContentPreviewArgs/);
  assert.match(lib,/buildContentMatchInfo/);
  assert.match(installer,/build_native_preview\.ps1/);
  assert.match(installer,/native_preview_host\.cs/);
  assert.match(installer,/NetunimPreviewHost\.exe/);
  assert.doesNotMatch(installer,/office_preview\.ps1/);
  assert.match(build,/csc\.exe/);
  assert.match(host,/interface IPreviewHandler/);
  assert.match(host,/IInitializeWithFile/);
  assert.match(host,/IInitializeWithItem/);
  assert.match(host,/8895b1c6-b41f-4c1c-a562-0d564250836f/i);
  assert.match(host,/handler\.SetWindow/);
  assert.match(host,/handler\.SetRect/);
  assert.match(host,/handler\.DoPreview/);
  assert.match(host,/SetProcessDpiAwarenessContext/);
  assert.match(host,/PerMonitorAwareV2/);
  assert.match(host,/GetClientRect/);
  assert.match(host,/interface IOleWindow/);
  assert.match(host,/GetParent\(previewWindow\) == Handle/);
  assert.match(host,/SynchronizePreviewBounds/);
  assert.match(host,/settlePassesRemaining/);
  assert.match(host,/SetWindowLongPtr/);
  assert.match(host,/SetWindowPos/);
  assert.equal([...Buffer.from(host,'utf8')].some(byte=>byte>0x7f),false,'native_preview_host.cs must remain ASCII-only');
  assert.equal([...Buffer.from(build,'utf8')].some(byte=>byte>0x7f),false,'build_native_preview.ps1 must remain ASCII-only');
  assert.match(client,/nativePreview/);
  assert.match(client,/moveNativePreview/);
  assert.match(client,/hideNativePreview/);
  assert.match(ui,/documentSearchMode='everything'/);
  assert.match(ui,/window\.devicePixelRatio/);
  assert.match(ui,/window\.addEventListener\('focus'/);
  assert.match(ui,/data.kind==='native'/);
  assert.match(ui,/toolbar=0&navpanes=0&view=FitH/);
  assert.match(ui,/dblclick/);
  assert.match(ui,/selectDocumentResult/);
  assert.match(ui,/document-results-table/);
  assert.match(ui,/document-preview-frame/);
  assert.match(ui,/document-preview-inline-match/);
  assert.match(ui,/:~:text=/);
  assert.match(ui,/pdfTextDirective/);
  assert.match(ui,/pdfFragmentContext/);
  assert.match(ui,/navigatePdfPreviewToMatch/);
  assert.match(ui,/URL\.createObjectURL\(previewPdfBlob\)/);
  assert.match(ui,/loadPreviewMatches/);
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

test('computer search UI keeps primary modes in the header and exposes a resizable preview split',()=>{
  const html=read('netunim-orders/site/index.html');
  const css=read('netunim-orders/site/assets/app.css');
  const ui=read('netunim-orders/site/assets/js/ui/global-search.js');
  assert.doesNotMatch(html,/id="globalSearchTitle"/);
  assert.match(html,/global-search-head[\s\S]*global-search-modebar/);
  assert.match(html,/חיפוש במחשב/);
  assert.match(html,/globalSearchDocumentSplitter/);
  assert.match(css,/--document-preview-width:58%/);
  assert.match(css,/document-result-icon\.pdf/);
  assert.match(css,/document-result-icon\.word/);
  assert.match(css,/document-result-icon\.folder/);
  assert.match(css,/document-preview-matches/);
  assert.match(css,/document-preview-inline-match/);
  assert.match(ui,/DOCUMENT_PREVIEW_WIDTH_KEY/);
  assert.match(ui,/documentSearchMode='everything'/);
  assert.match(ui,/documentIconKind/);
  assert.match(ui,/setPointerCapture/);
  assert.match(ui,/requestAnimationFrame\(flushResize\)/);
  assert.match(ui,/nativePreviewMoveInFlight/);
  assert.match(ui,/scheduleNativePreviewGeometry/);
});

test('orders service worker contains the current document bridge client after asset synchronization',()=>{
  const sw=read('netunim-orders/site/service-worker.js');
  assert.match(sw,/\.\/assets\/js\/domains\/documents\/bridge\.js/);
});

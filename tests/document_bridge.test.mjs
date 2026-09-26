import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContentQuery,buildEverythingQuery,buildEsCountArgs,buildEsSearchArgs,mergeDocumentResults,
  normalizeSearchText,originAllowed,parseEsCount,parseEsJson,parseRegistryInstallLocation,
} from '../netunim-orders/document-bridge/lib.mjs';

test('content search is a literal Everything content: query while direct mode mirrors Everything syntax',()=>{
  assert.equal(buildContentQuery('  יבמות   פרק  '),'content:"יבמות פרק" no-background-search:');
  assert.equal(buildContentQuery('a'),'');
  assert.equal(buildEverythingQuery('  יבמות   ext:pdf  '),'יבמות ext:pdf');
  assert.equal(buildEverythingQuery('a'),'a');
  assert.equal(normalizeSearchText('a\n b'),'a b');
});

test('ES invocation forces Unicode argv parsing and UTF-8 pipe output',()=>{
  const args=buildEsSearchArgs({query:'יבמות',mode:'everything',limit:999,timeoutMs:1,instance:'1.5a'});
  assert.deepEqual(args.slice(0,7),['-argv','-cp','65001','-ipc3','-instance','1.5a','-timeout']);
  assert.ok(args.includes('-json'));
  assert.equal(args[args.indexOf('-n')+1],'120');
  assert.equal(args[args.indexOf('-search')+1],'יבמות');
  assert.equal(args.includes('-path'),false);
  assert.equal(args.includes('/a-d'),false);

  const content=buildEsSearchArgs({query:'יבמות',mode:'content'});
  assert.ok(content.includes('/a-d'));
  assert.equal(content[content.indexOf('-search')+1],'content:"יבמות" no-background-search:');
});

test('ES JSON parser preserves Hebrew/Unicode names and full indexed paths without root filtering',()=>{
  const json=JSON.stringify({results:[
    {Name:'מסכת יבמות.pdf',Path:'Y:\\ספרים\\שס',Size:'1024','Date Modified':'2026-09-25T12:00:00Z'},
    {Name:'שיעור.docx',Path:'C:\\Users\\יעקב\\Documents',Size:'2048','Date Modified':'2026-09-24T10:00:00Z'},
  ]});
  const rows=parseEsJson(json);
  assert.equal(rows.length,2);
  assert.deepEqual(rows[0],{name:'מסכת יבמות.pdf',fullPath:'Y:\\ספרים\\שס\\מסכת יבמות.pdf',relativePath:'Y:\\ספרים\\שס',modified:'2026-09-25T12:00:00Z',size:1024,extension:'pdf',rootId:'everything',rootLabel:'Everything'});
  assert.equal(rows[1].name,'שיעור.docx');
  assert.equal(rows[1].fullPath,'C:\\Users\\יעקב\\Documents\\שיעור.docx');
});

test('global Everything result merging dedupes only identical paths',()=>{
  const a={name:'א.pdf',fullPath:'Y:\\Docs\\א.pdf',modified:'2026-09-24T00:00:00Z'};
  const duplicate={...a,fullPath:'y:\\docs\\א.PDF'};
  const other={...a,fullPath:'C:\\Docs\\א.pdf',modified:'2026-09-25T00:00:00Z'};
  const rows=mergeDocumentResults([[a,duplicate,other]],10);
  assert.equal(rows.length,2);
  assert.equal(rows[0].fullPath,'C:\\Docs\\א.pdf');
});

test('index count requests are global and Unicode-safe',()=>{
  const args=buildEsCountArgs({search:'is-indexed-property:content',instance:'1.5a'});
  assert.deepEqual(args.slice(0,7),['-argv','-cp','65001','-ipc3','-instance','1.5a','-timeout']);
  assert.ok(args.includes('-get-result-count'));
  assert.equal(args.includes('-path'),false);
  assert.equal(args[args.indexOf('-search')+1],'is-indexed-property:content');
  assert.equal(parseEsCount('123\r\n'),123);
  assert.throws(()=>parseEsCount('oops'),/invalid result count/i);
});

test('origin allowlist supports only configured website families and local development',()=>{
  const patterns=['https://bargig-orders.pages.dev','https://*.bargig-orders.pages.dev','https://*.bargig-furniture.com','http://localhost:*'];
  assert.equal(originAllowed('https://orders.bargig-furniture.com',patterns),true);
  assert.equal(originAllowed('https://abc.bargig-orders.pages.dev',patterns),true);
  assert.equal(originAllowed('https://abc.pages.dev',patterns),false);
  assert.equal(originAllowed('http://localhost:8082',patterns),true);
  assert.equal(originAllowed('https://evil.example',patterns),false);
});

test('Everything install location is parsed from official registry query output',()=>{
  const stdout='HKEY_LOCAL_MACHINE\\SOFTWARE\\voidtools\\Everything\r\n    InstallLocation    REG_SZ    C:\\Program Files\\Everything\r\n';
  assert.equal(parseRegistryInstallLocation(stdout),'C:\\Program Files\\Everything');
  assert.equal(parseRegistryInstallLocation(''),'');
});

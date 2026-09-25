import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContentQuery,buildEsSearchArgs,mergeDocumentResults,normalizeRoots,normalizeSearchText,originAllowed,parseEsJson,pathInsideRoot,
} from '../netunim-orders/document-bridge/lib.mjs';

test('document bridge turns browser text into bounded PDF content terms instead of raw Everything syntax',()=>{
  assert.equal(buildContentQuery('  משה   כהן  '),'ext:pdf content:"משה" content:"כהן"');
  const hostile=buildContentQuery('invoice" | ext:exe');
  assert.equal(hostile,'ext:pdf content:"invoice&quot:" content:"|" content:"ext:exe"');
  assert.ok(hostile.startsWith('ext:pdf '));
  assert.equal(buildContentQuery('a'),'');
  assert.equal(normalizeSearchText('a\n b'),'a b');
});

test('document roots are normalized per computer and containment rejects sibling traversal',()=>{
  const roots=normalizeRoots(['G:/My Drive/PDF/','Z:\\Shared PDFs','g:\\my drive\\pdf']);
  assert.equal(roots.length,2);
  assert.equal(roots[0].path,'G:\\My Drive\\PDF');
  assert.equal(pathInsideRoot('G:\\My Drive\\PDF\\2026\\a.pdf',roots[0].path),true);
  assert.equal(pathInsideRoot('G:\\My Drive\\PDF-old\\a.pdf',roots[0].path),false);
  assert.equal(pathInsideRoot('G:\\My Drive\\other\\a.pdf',roots[0].path),false);
  assert.equal(pathInsideRoot('\\\\server\\share\\pdf\\a.pdf','\\\\server\\share\\pdf'),true);
});

test('ES JSON parsing accepts named columns, enforces PDF/root boundaries and keeps relative display paths',()=>{
  const json=JSON.stringify({results:[
    {Name:'invoice.pdf',Path:'Z:\\Shared PDFs\\2026',Size:'1,024','Date Modified':'2026-09-25T12:00:00Z'},
    {Name:'note.txt',Path:'Z:\\Shared PDFs',Size:'2'},
    {Name:'escape.pdf',Path:'Z:\\Other',Size:'3'},
  ]});
  const rows=parseEsJson(json,{root:{id:'network',label:'משותף',path:'Z:\\Shared PDFs'}});
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0],{name:'invoice.pdf',fullPath:'Z:\\Shared PDFs\\2026\\invoice.pdf',relativePath:'2026',modified:'2026-09-25T12:00:00Z',size:1024,rootId:'network',rootLabel:'משותף'});
});

test('merged results dedupe the same indexed path but retain separate mirrored copies',()=>{
  const a={name:'a.pdf',fullPath:'Z:\\Docs\\a.pdf',modified:'2026-09-24T00:00:00Z'};
  const duplicate={...a,fullPath:'z:\\docs\\A.pdf'};
  const mirror={...a,fullPath:'G:\\Drive\\a.pdf',modified:'2026-09-25T00:00:00Z'};
  const rows=mergeDocumentResults([[a],[duplicate,mirror]],10);
  assert.equal(rows.length,2);
  assert.equal(rows[0].fullPath,'G:\\Drive\\a.pdf');
});

test('origin allowlist supports only the configured website families and local development',()=>{
  const patterns=['https://bargig-orders.pages.dev','https://*.bargig-orders.pages.dev','https://*.bargig-furniture.com','http://localhost:*'];
  assert.equal(originAllowed('https://orders.bargig-furniture.com',patterns),true);
  assert.equal(originAllowed('https://abc.bargig-orders.pages.dev',patterns),true);
  assert.equal(originAllowed('https://abc.pages.dev',patterns),false);
  assert.equal(originAllowed('http://localhost:8082',patterns),true);
  assert.equal(originAllowed('https://evil.example',patterns),false);
});

test('ES invocation is fixed to IPC3, PDF content, files-only and the configured root',()=>{
  const args=buildEsSearchArgs({root:{path:'Z:\\Shared PDFs'},query:'משה | ext:exe',limit:999,timeoutMs:1,instance:'1.5a'});
  assert.deepEqual(args.slice(0,4),['-ipc3','-instance','1.5a','-timeout']);
  assert.ok(args.includes('-json'));
  assert.ok(args.includes('/a-d'));
  assert.equal(args[args.indexOf('-path')+1],'Z:\\Shared PDFs');
  assert.equal(args[args.indexOf('-n')+1],'80');
  assert.equal(args[args.length-1],'ext:pdf content:"משה" content:"|" content:"ext:exe"');
});

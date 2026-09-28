import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContentMatchInfo,buildContentQuery,buildEverythingQuery,buildEsContentPreviewArgs,buildEsCountArgs,buildEsRecentFilesArgs,buildEsSearchArgs,mergeDocumentResults,RECENT_RESULT_LIMIT,
  normalizeSearchText,officePreviewKind,structuredPreviewKind,originAllowed,parseEsContentPreview,parseEsCount,parseEsJson,parseRegistryInstallLocation,
} from '../netunim-orders/document-bridge/lib.mjs';


test('selected-file content match info is bounded and returns highlighted snippets without rescanning result lists',()=>{
  const info=buildContentMatchInfo('פתיחה ואז מילה אחת באמצע. עוד טקסט. מילה אחת בסוף.','מילה אחת',{contextChars:12,maxSnippets:4});
  assert.equal(info.query,'מילה אחת');
  assert.equal(info.count,2);
  assert.equal(info.snippets.length,2);
  assert.equal(info.snippets[0].match,'מילה אחת');
  assert.equal(info.snippets[1].match,'מילה אחת');
  assert.equal(info.capped,false);
  const capped=buildContentMatchInfo('abc abc abc abc','abc',{maxSnippets:2,maxMatches:3});
  assert.equal(capped.count,3);
  assert.equal(capped.snippets.length,2);
  assert.equal(capped.capped,true);
});

test('content search is a literal Everything content: query while direct mode mirrors Everything syntax',()=>{
  assert.equal(buildContentQuery('  יבמות   פרק  '),'content:"יבמות פרק" no-background-search:');
  assert.equal(buildContentQuery('0501234567'),'content:"0501234567" no-background-search:');
  assert.equal(buildContentQuery('050-1234567'),'content:"050-1234567" no-background-search:');
  assert.equal(buildContentQuery('050 1234567'),'content:"050 1234567" no-background-search:');
  assert.equal(buildContentQuery('a'),'');
  assert.equal(buildEverythingQuery('  יבמות   ext:pdf  '),'יבמות ext:pdf');
  assert.equal(buildEverythingQuery('a'),'a');
  assert.equal(normalizeSearchText('a\n b'),'a b');
});

test('recent files query allows 150 results without raising normal search limits',()=>{
  assert.equal(RECENT_RESULT_LIMIT,150);
  const args=buildEsRecentFilesArgs({limit:999,instance:'1.5a'});
  assert.ok(args.includes('/a-d'));
  assert.equal(args[args.indexOf('-max-results')+1],'150');
  assert.equal(args[args.indexOf('-sort')+1],'date-modified-descending');
  assert.equal(args[args.indexOf('--')+1],'*');
  const normal=buildEsSearchArgs({query:'קובץ',mode:'everything',limit:999});
  assert.equal(normal[normal.indexOf('-max-results')+1],'120');
  const rows=Array.from({length:160},(_,index)=>({fullPath:`C:\\recent\\${index}.txt`,name:`${index}.txt`,modified:new Date(2026,0,1,0,index).toISOString()}));
  assert.equal(mergeDocumentResults([rows],999).length,120,'normal result merging keeps the existing 120-result ceiling');
  assert.equal(mergeDocumentResults([rows],999,RECENT_RESULT_LIMIT).length,150,'recent-file merging has its own 150-result ceiling');
});

test('ES invocation forces Unicode argv parsing and UTF-8 pipe output',()=>{
  const args=buildEsSearchArgs({query:'יבמות',mode:'everything',limit:999,timeoutMs:1,instance:'1.5a'});
  assert.deepEqual(args.slice(0,7),['-argv','-cp','65001','-ipc3','-instance','1.5a','-timeout']);
  assert.ok(args.includes('-json'));
  assert.equal(args[args.indexOf('-max-results')+1],'120');
  assert.equal(args.includes('-n'),false);
  assert.equal(args.includes('-search'),false);
  assert.equal(args[args.indexOf('--')+1],'יבמות');
  assert.equal(args.includes('-path'),false);
  assert.equal(args.includes('/a-d'),false);

  const content=buildEsSearchArgs({query:'יבמות',mode:'content'});
  assert.ok(content.includes('/a-d'));
  assert.equal(content.includes('-search'),false);
  assert.equal(content[content.indexOf('--')+1],'content:"יבמות" no-background-search:');

  const phrase=buildEsSearchArgs({query:'מילה אחת',mode:'content'});
  assert.equal(phrase[phrase.indexOf('--')+1],'content:"מילה אחת" no-background-search:');
});

test('ES JSON parser preserves Hebrew/Unicode names and full indexed paths without root filtering',()=>{
  const json=JSON.stringify({results:[
    {Name:'מסכת יבמות.pdf',Path:'Y:\\ספרים\\שס',Size:'1024','Date Modified':'2026-09-25T12:00:00Z'},
    {Name:'שיעור.docx',Path:'C:\\Users\\יעקב\\Documents',Size:'2048','Date Modified':'2026-09-24T10:00:00Z'},
  ]});
  const rows=parseEsJson(json);
  assert.equal(rows.length,2);
  assert.deepEqual(rows[0],{name:'מסכת יבמות.pdf',fullPath:'Y:\\ספרים\\שס\\מסכת יבמות.pdf',relativePath:'Y:\\ספרים\\שס',modified:'2026-09-25T12:00:00Z',size:1024,extension:'pdf',attributes:'',isDirectory:false,rootId:'everything',rootLabel:'Everything'});
  assert.equal(rows[1].name,'שיעור.docx');
  assert.equal(rows[1].fullPath,'C:\\Users\\יעקב\\Documents\\שיעור.docx');
});


test('Office preview classification identifies formats that should use the native Windows preview handler',()=>{
  assert.equal(officePreviewKind('docx'),'word');
  assert.equal(officePreviewKind('.rtf'),'word');
  assert.equal(officePreviewKind('xlsx'),'excel');
  assert.equal(officePreviewKind('pptx'),'powerpoint');
  assert.equal(officePreviewKind('pdf'),'');
});

test('content preview classification uses controlled local renderers only for supported Word OOXML and Excel formats',()=>{
  assert.equal(structuredPreviewKind('docx'),'word');
  assert.equal(structuredPreviewKind('docm'),'word');
  assert.equal(structuredPreviewKind('doc'),'');
  assert.equal(structuredPreviewKind('rtf'),'');
  assert.equal(structuredPreviewKind('xlsx'),'spreadsheet');
  assert.equal(structuredPreviewKind('xls'),'spreadsheet');
  assert.equal(structuredPreviewKind('xlsb'),'spreadsheet');
  assert.equal(structuredPreviewKind('pptx'),'');
});

test('preview query addresses one exact full path and requests Everything content as a property',()=>{
  const args=buildEsContentPreviewArgs({fullPath:'C:\\Users\\Test\\My File.docx',instance:'1.5a'});
  assert.ok(args.includes('-add-columns'));
  assert.equal(args[args.indexOf('-add-columns')+1],'content');
  assert.equal(args[args.indexOf('-max-results')+1],'1');
  assert.equal(args[args.indexOf('--')+1],'whole:fullpath:"C:\\Users\\Test\\My File.docx"');
  assert.equal(parseEsContentPreview(JSON.stringify({results:[{Name:'My File.docx',Content:'preview text'}]})),'preview text');
});

test('ES JSON parser identifies folder results from the attributes column',()=>{
  const rows=parseEsJson(JSON.stringify({results:[{Name:'Folder',Path:'C:\\Docs',Attributes:'DA','Date Modified':'2026-09-25T12:00:00Z'}]}));
  assert.equal(rows.length,1);
  assert.equal(rows[0].isDirectory,true);
  assert.equal(rows[0].attributes,'DA');
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
  assert.equal(args.includes('-search'),false);
  assert.equal(args[args.indexOf('--')+1],'is-indexed-property:content');
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

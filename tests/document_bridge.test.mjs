import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bridgeNodeVersionSupported,buildContentMatchInfo,buildContentQuery,buildEverythingQuery,buildEsContentPreviewArgs,buildEsCountArgs,buildEsPdfInventoryArgs,buildEsRecentFilesArgs,buildEsSearchArgs,compareDocumentRows,contentSearchMatches,documentExtension,mergeDocumentResults,normalizeDocumentSort,RECENT_RESULT_LIMIT,
  normalizeSearchText,normalizeSearchScopePath,officePreviewKind,structuredPreviewKind,originAllowed,parseEsContentPreview,parseEsCount,parseEsJson,parseRegistryInstallLocation,
} from '../netunim-orders/document-bridge/lib.mjs';
import {pdfIndexNeedsInspection} from '../netunim-orders/document-bridge/pdf-index-policy.mjs';
import {deleteLocalDocumentResult} from '../netunim-orders/site/assets/js/ui/document-result-menu.js';
import {createDomainsDocumentSearch} from '../netunim-orders/site/assets/js/domains/documents/search-source.js';


test('Windows Bridge Node runtime contract targets the Node 24 LTS line',()=>{
  assert.equal(bridgeNodeVersionSupported('24.11.0'),true);
  assert.equal(bridgeNodeVersionSupported('24.18.0'),true);
  assert.equal(bridgeNodeVersionSupported('24.21.0'),true);
  assert.equal(bridgeNodeVersionSupported('24.10.0'),false);
  assert.equal(bridgeNodeVersionSupported('22.22.0'),false);
  assert.equal(bridgeNodeVersionSupported('26.0.0'),false);
  assert.equal(bridgeNodeVersionSupported('not-a-version'),false);
});

test('local document delete requires confirmation and invalidates only returned result ids',async()=>{
  const calls=[],button={disabled:false,isConnected:true};
  const options={id:'opaque-7',button,item:{name:'report.pdf',isDirectory:false},
    bridge:{deleteDocument:async id=>{calls.push(['delete',id]);return {invalidatedIds:['opaque-7','opaque-8']}}},
    beforeDelete:async()=>calls.push(['preview-closed']),
    afterDelete:ids=>calls.push(['invalidated',ids]),
    showStatus:message=>calls.push(['status',message])};
  await deleteLocalDocumentResult({...options,confirmDialog:async()=>false});
  assert.deepEqual(calls,[]);
  await deleteLocalDocumentResult({...options,confirmDialog:async(title,message,settings)=>{
    assert.equal(title,'למחוק את הקובץ?');
    assert.match(message,/report\.pdf/);
    assert.equal(settings.tone,'danger');
    assert.equal(settings.defaultFocus,'confirm');
    assert.equal(settings.confirmOnEnter,true);
    calls.push(['confirmed']);return true;
  }});
  assert.deepEqual(calls.slice(0,4),[['confirmed'],['preview-closed'],['delete','opaque-7'],['invalidated',['opaque-7','opaque-8']]]);
  assert.equal(button.disabled,false);
});


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

test('content search supports Everything 1.5 phrase, AND, OR and ordered word-distance syntax',()=>{
  assert.equal(buildContentQuery('  יבמות   פרק  '),'content:"יבמות פרק" no-background-search:');
  const phoneQuery=buildContentQuery('0501234567');
  assert.match(phoneQuery,/^regex:content:/);
  assert.equal(buildContentQuery('050-1234567'),phoneQuery);
  assert.equal(buildContentQuery('050 1234567'),phoneQuery);
  assert.match(phoneQuery,/05/);assert.match(phoneQuery,/050/);assert.match(phoneQuery,/\\s/);
  assert.equal(buildContentQuery('מה שלומך',{matchMode:'all'}),'content:<"מה" "שלומך"> no-background-search:');
  assert.equal(buildContentQuery('מה שלומך',{matchMode:'any'}),'content:<"מה"|"שלומך"> no-background-search:');
  assert.equal(buildContentQuery('מה שלומך',{matchMode:'proximity',proximityWords:10}),'regex:content:"מה(?:\\s+\\S+){0,10}\\s+שלומך" no-background-search:');
  assert.equal(buildContentQuery('a+b c?',{matchMode:'proximity',proximityWords:3}),'regex:content:"a\\+b(?:\\s+\\S+){0,3}\\s+c\\?" no-background-search:');
  assert.equal(buildContentQuery('a'),'');
  assert.equal(buildEverythingQuery('  יבמות   ext:pdf  '),'יבמות ext:pdf');
  assert.equal(buildEverythingQuery('a'),'a');
  assert.equal(normalizeSearchText('a\n b'),'a b');
});

test('phone-like content searches match optional separator only after a 2- or 3-digit prefix',()=>{
  const text='A 0501234567 B 050-1234567 C 050 1234567 D 05-01234567 E 050-123-4567';
  const info=buildContentMatchInfo(text,'050 1234567');
  assert.equal(info.count,4);
  assert.deepEqual(info.snippets.map(row=>row.match),['0501234567','050-1234567','050 1234567','05-01234567']);
});

test('preview match extraction follows advanced content-search semantics',()=>{
  const text='פתיחה מה אחד שני שלומך. וגם מילה אחרת.';
  assert.equal(buildContentMatchInfo(text,'מה שלומך',{matchMode:'phrase'}).count,0);
  assert.equal(buildContentMatchInfo(text,'מה שלומך',{matchMode:'all'}).count,2);
  assert.equal(buildContentMatchInfo(text,'מה חסרה',{matchMode:'all'}).count,0);
  assert.equal(buildContentMatchInfo(text,'מה חסרה',{matchMode:'any'}).count,1);
  const close=buildContentMatchInfo(text,'מה שלומך',{matchMode:'proximity',proximityWords:2});
  assert.equal(close.count,1);
  assert.equal(close.snippets[0].match,'מה אחד שני שלומך');
  assert.equal(buildContentMatchInfo(text,'מה שלומך',{matchMode:'proximity',proximityWords:1}).count,0);
});


test('interactive PDF supplemental matching uses the same content-search semantics as Everything mode controls',()=>{
  const value='שם לקוח ליבי מאיר טלפון 0533161179 כתובת בני ברק';
  assert.equal(contentSearchMatches(value,'ליבי מאיר',{matchMode:'phrase'}),true);
  assert.equal(contentSearchMatches(value,'ליבי כתובת',{matchMode:'all'}),true);
  assert.equal(contentSearchMatches(value,'ליבי חסר',{matchMode:'all'}),false);
  assert.equal(contentSearchMatches(value,'ליבי חסר',{matchMode:'any'}),true);
  assert.equal(contentSearchMatches(value,'ליבי טלפון',{matchMode:'proximity',proximityWords:2}),true);
  assert.equal(contentSearchMatches(value,'053-3161179',{matchMode:'phrase'}),true);
});

test('PDF inventory query pages only PDF files from the Everything database',()=>{
  const args=buildEsPdfInventoryArgs({limit:250,offset:500,instance:'1.5a'});
  assert.ok(args.includes('/a-d'));
  assert.equal(args[args.indexOf('-max-results')+1],'250');
  assert.equal(args[args.indexOf('-offset')+1],'500');
  assert.equal(args[args.indexOf('--')+1],'ext:pdf');
  const incremental=buildEsPdfInventoryArgs({modifiedSince:'2026-09-29'});
  assert.equal(incremental[incremental.indexOf('--')+1],'ext:pdf dm:>=2026-09-29');
  assert.throws(()=>buildEsPdfInventoryArgs({modifiedSince:'today | content:secret'}),/Invalid PDF inventory checkpoint date/);
  assert.equal(documentExtension('C:\\archive\\.pdf'),'pdf');
  assert.equal(parseEsJson(JSON.stringify({results:[{name:'.pdf',path:'C:\\archive',size:1}]}))[0].extension,'pdf');
});

test('PDF maintenance skips current negative and geometry-only records, and backs off failures',()=>{
  const now=Date.UTC(2026,8,30),revisions={detectionRevision:2,searchTextRevision:2};
  const needs=(entry,fingerprint='10:date')=>pdfIndexNeedsInspection(entry,fingerprint,now,revisions);
  assert.equal(needs(null),true);
  assert.equal(needs({fingerprint:'10:date',hasForm:false,detectionRevision:2}),false);
  assert.equal(needs({fingerprint:'10:date',hasForm:false,detectionRevision:1}),true);
  assert.equal(needs({fingerprint:'10:date',hasForm:true,detectionRevision:2,searchTextRevision:2,formFields:[]}),false);
  assert.equal(needs({fingerprint:'10:date',hasForm:true,detectionRevision:2,searchTextRevision:1}),true);
  assert.equal(needs({fingerprint:'10:date',failed:true,retryAfter:'2026-10-01T00:00:00Z'}),false);
  assert.equal(needs({fingerprint:'10:date',failed:true,retryAfter:'2026-09-29T00:00:00Z'}),true);
  assert.equal(needs({fingerprint:'10:date',hasForm:false,detectionRevision:2},'11:date'),true);
});

test('document search defaults to 150 results and supports bounded paging beyond the first batch',()=>{
  assert.equal(RECENT_RESULT_LIMIT,150);
  const args=buildEsRecentFilesArgs({limit:999,instance:'1.5a'});
  assert.ok(args.includes('/a-d'));
  assert.equal(args[args.indexOf('-max-results')+1],'150');
  assert.equal(args[args.indexOf('-sort')+1],'date-modified-descending');
  assert.equal(args[args.indexOf('--')+1],'*');
  const normal=buildEsSearchArgs({query:'קובץ',mode:'everything',limit:999,offset:300});
  assert.equal(normal[normal.indexOf('-max-results')+1],'999');
  assert.equal(normal[normal.indexOf('-offset')+1],'300');
  const scopedRecent=buildEsRecentFilesArgs({limit:25,scopePath:'Y:\\Orders'});
  assert.deepEqual(scopedRecent.slice(scopedRecent.indexOf('-path'),scopedRecent.indexOf('-path')+2),['-path','Y:\\Orders']);
  const rows=Array.from({length:160},(_,index)=>({fullPath:`C:\\recent\\${index}.txt`,name:`${index}.txt`,modified:new Date(2026,0,1,0,index).toISOString()}));
  assert.equal(mergeDocumentResults([rows],150).length,150,'the first normal result batch is 150 rows');
  assert.equal(mergeDocumentResults([rows],999).length,160,'normal merging can retain later batches instead of hard-capping at 120');
  assert.equal(mergeDocumentResults([rows],999,RECENT_RESULT_LIMIT).length,150,'recent-file merging keeps its dedicated 150-result ceiling');
});

test('Everything sorting accepts the four result columns with Everything-like first directions',()=>{
  assert.deepEqual(normalizeDocumentSort({field:'name'}),{field:'name',direction:'asc'});
  assert.deepEqual(normalizeDocumentSort({field:'path'}),{field:'path',direction:'asc'});
  assert.deepEqual(normalizeDocumentSort({field:'size'}),{field:'size',direction:'desc'});
  assert.deepEqual(normalizeDocumentSort({field:'modified'}),{field:'modified',direction:'desc'});
  assert.deepEqual(normalizeDocumentSort({field:'bad',direction:'sideways'}),{field:'modified',direction:'desc'});
  for(const [sort,expected] of [
    [{field:'name',direction:'asc'},'name-ascending'],
    [{field:'name',direction:'desc'},'name-descending'],
    [{field:'path',direction:'asc'},'path-ascending'],
    [{field:'size',direction:'desc'},'size-descending'],
    [{field:'modified',direction:'asc'},'date-modified-ascending'],
  ]){const args=buildEsSearchArgs({query:'קובץ',sort});assert.equal(args[args.indexOf('-sort')+1],expected)}
  const rows=[
    {name:'ב.txt',relativePath:'Y:\\Z',fullPath:'Y:\\Z\\ב.txt',size:10,modified:'2026-09-29T00:00:00Z'},
    {name:'א.txt',relativePath:'Y:\\A',fullPath:'Y:\\A\\א.txt',size:20,modified:'2026-09-30T00:00:00Z'},
  ];
  assert.equal([...rows].sort((a,b)=>compareDocumentRows(a,b,{field:'name',direction:'asc'}))[0].name,'א.txt');
  assert.equal([...rows].sort((a,b)=>compareDocumentRows(a,b,{field:'size',direction:'desc'}))[0].size,20);
  assert.equal([...rows].sort((a,b)=>compareDocumentRows(a,b,{field:'modified',direction:'asc'}))[0].modified,'2026-09-29T00:00:00Z');
});

test('ES invocation forces Unicode argv parsing and UTF-8 pipe output',()=>{
  const args=buildEsSearchArgs({query:'יבמות',mode:'everything',limit:999,offset:150,timeoutMs:1,instance:'1.5a'});
  assert.deepEqual(args.slice(0,7),['-argv','-cp','65001','-ipc3','-instance','1.5a','-timeout']);
  assert.ok(args.includes('-json'));
  assert.equal(args[args.indexOf('-max-results')+1],'999');
  assert.equal(args[args.indexOf('-offset')+1],'150');
  assert.equal(args.includes('-n'),false);
  assert.equal(args.includes('-search'),false);
  assert.equal(args[args.indexOf('--')+1],'יבמות');
  assert.equal(args.includes('-path'),false);
  assert.equal(args.includes('/a-d'),false);
  const scoped=buildEsSearchArgs({query:'יבמות',mode:'everything',scopePath:'Y:\\Orders'});
  assert.deepEqual(scoped.slice(scoped.indexOf('-path'),scoped.indexOf('-path')+2),['-path','Y:\\Orders']);
  assert.equal(normalizeSearchScopePath('Y:/Orders/'),'Y:\\Orders');
  assert.throws(()=>normalizeSearchScopePath('relative\\folder'),/absolute Windows path/);

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
  const patterns=['https://bargig-orders.pages.dev','https://*.bargig-orders.pages.dev','https://bargig-kupa.pages.dev','https://*.bargig-kupa.pages.dev','https://*.bargig-furniture.com','http://localhost:*'];
  assert.equal(originAllowed('https://orders.bargig-furniture.com',patterns),true);
  assert.equal(originAllowed('https://abc.bargig-orders.pages.dev',patterns),true);
  assert.equal(originAllowed('https://bargig-kupa.pages.dev',patterns),true);
  assert.equal(originAllowed('https://abc.bargig-kupa.pages.dev',patterns),true);
  assert.equal(originAllowed('https://abc.pages.dev',patterns),false);
  assert.equal(originAllowed('http://localhost:8082',patterns),true);
  assert.equal(originAllowed('https://evil.example',patterns),false);
});

test('Everything install location is parsed from official registry query output',()=>{
  const stdout='HKEY_LOCAL_MACHINE\\SOFTWARE\\voidtools\\Everything\r\n    InstallLocation    REG_SZ    C:\\Program Files\\Everything\r\n';
  assert.equal(parseRegistryInstallLocation(stdout),'C:\\Program Files\\Everything');
  assert.equal(parseRegistryInstallLocation(''),'');
});


test('unified local document source returns prefixed invalidation ids after delete',async()=>{
  const calls=[];const localBridge={deleteDocument:async id=>{calls.push(id);return {ok:true,invalidatedIds:[id,'sibling']}}};
  const source=createDomainsDocumentSearch({localBridge,userAgent:'Windows NT'}),result=await source.deleteDocument('local:opaque-7');
  assert.deepEqual(calls,['opaque-7']);
  assert.deepEqual(result.invalidatedIds,['local:opaque-7','local:sibling']);
});

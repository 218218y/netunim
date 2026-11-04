import test from 'node:test';
import assert from 'node:assert/strict';
import {recentDocumentLabels,renderGlobalDocumentSource,renderGlobalRecentDocumentBody,renderGlobalSiteSource} from '../netunim-orders/site/assets/js/shared/global-document-search-source-view.js';

test('site source view escapes rendered content and registers stable result keys',()=>{
  const item={kind:'note',id:'note-1',title:'<img src=x>',context:'Context',badge:'Note',subtitle:'Details'};
  const registered=[];
  const view=renderGlobalSiteSource('query',{
    siteSearch:(query,options)=>{assert.equal(query,'query');assert.equal(options.limitPerGroup,1);return {total:2,groups:[{key:'notes',label:'Notes',total:2,items:[item]}]};},
    siteResultMeta:()=>['<meta>'],siteResultLimit:1,siteResultMax:5,
    registerResult:(key,row)=>registered.push([key,row]),
  });
  assert.equal(view.total,2);assert.equal(view.settledEmpty,false);assert.equal(view.hasMore,true);
  assert.deepEqual(registered,[['notes:note:note-1:0',item]]);
  assert.ok(view.html.includes('&lt;img src=x&gt;')&&view.html.includes('&lt;meta&gt;'));
  assert.ok(view.html.includes('data-site-load-more'));
  assert.ok(!view.html.includes('<img src=x>'));
});

test('document source view composes loading and partial states through its view ports',()=>{
  const calls=[];
  const loading=renderGlobalDocumentSource('content','query',{
    state:{status:'loading',rows:[],partial:false},label:'Content',filter:'all',
    documentProviderLabel:()=> 'Local',documentPairing:()=>'',documentErrorHtml:()=>'',documentIntro:()=>'',
    renderDocumentTable:()=>'',providerNoticeHtml:()=>'<aside>Provider</aside>',
  });
  assert.equal(loading.total,0);assert.equal(loading.settledEmpty,false);
  assert.ok(loading.html.includes('data-search-source="content"')&&loading.html.includes('Provider'));

  const partial=renderGlobalDocumentSource('content','query',{
    state:{status:'done',rows:[{id:'doc-1'}],hasMore:true,loadingMore:false,partial:true},label:'Content',filter:'content',
    documentProviderLabel:()=> 'Local',documentPairing:()=>'',documentErrorHtml:(error,retry)=>`<b>${retry}</b>`,documentIntro:()=>'',
    renderDocumentTable:(rows,mode,options)=>{calls.push([rows,mode,options]);return '<table>Results</table>';},
    providerNoticeHtml:()=>'<aside>Provider</aside>',
  });
  assert.equal(partial.total,1);assert.equal(partial.settledEmpty,false);
  assert.deepEqual(calls,[[[{id:'doc-1'}],'content',{hasMore:true}]]);
  assert.ok(partial.html.includes('<table>Results</table>')&&partial.html.includes('data-document-load-more="content"'));
});

test('recent-document view keeps provider and empty-state text escaped',()=>{
  assert.deepEqual(recentDocumentLabels('folders'),{
    label:'\u05ea\u05d9\u05e7\u05d9\u05d5\u05ea \u05d0\u05d7\u05e8\u05d5\u05e0\u05d5\u05ea',
    emptyLabel:'\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05ea\u05d9\u05e7\u05d9\u05d5\u05ea',
  });
  const args=[];
  const body=renderGlobalRecentDocumentBody({status:'done'},[{id:'file-1'}],{
    label:'Files',emptyLabel:'No files',provider:'<Drive>',documentPairing:()=>'<div>Pairing</div>',
    documentErrorHtml:()=>'<div>Error</div>',renderDocumentTable:(...values)=>{args.push(values);return '<table>Recent</table>';},
    recentDocumentSort:{field:'modified',direction:'desc'},
  });
  assert.ok(body.includes('<table>Recent</table>'));
  assert.deepEqual(args[0][0],[{id:'file-1'}]);assert.equal(args[0][1],'everything');
  assert.equal(args[0][2].label,'Files');assert.equal(args[0][2].sortScope,'recent');
  assert.deepEqual(args[0][2].sort,{field:'modified',direction:'desc'});assert.equal(typeof args[0][2].hint,'string');
  const empty=renderGlobalRecentDocumentBody({status:'done'},[],{
    label:'Files',emptyLabel:'No files',provider:'<Drive>',documentPairing:()=>'',documentErrorHtml:()=>'',renderDocumentTable:()=>'',recentDocumentSort:null,
  });
  assert.ok(empty.includes('No files')&&empty.includes('&lt;Drive&gt;'));
});

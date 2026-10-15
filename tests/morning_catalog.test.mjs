import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createMorningCatalog,defaultDocumentSearch} from '../netunim-orders/site/assets/js/domains/customers/morning-catalog.js';
import {decodeMorningCatalogPage,decodeMorningCatalogDocument,decodeMorningCatalogMetadata,decodeMorningCatalogLink} from '../netunim-orders/site/assets/js/domains/customers/morning-catalog-evidence.js';
const doc={id:'document',number:4001,type:400,amount:30,date:'2026-10-15',clientName:'customer',currency:'ILS',status:0};
const status={operation:{operation_id:'operation',state:'created',verified_at:'2026-10-15T00:00:00Z',document_id:'document',document_number:4001,document_type:400}};
const invalid=error=>error.code==='morning_catalog_invalid';
const original=JSON.parse(readFileSync(new URL('./fixtures/morning-catalog-policy.json',import.meta.url),'utf8')).functions.verifiedOperationMetadata.source;
function gate(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function fixture(){let now=0,epoch=1;const calls=[],responses=new Map([['search_documents',{items:[doc],total:1,pages:1}],['status',status],['get_document',{document:doc}],['document_links',{url:'https://example.test/file'}]]);
 const catalog=createMorningCatalog({authority:{capture:()=>{const expected=epoch;return ()=>{if(epoch!==expected)throw Object.assign(Error('scope changed'),{code:'MORNING_OPERATION_SCOPE_CHANGED'})}}},request:{json:async(action,payload,guard)=>{calls.push({action,payload});const result=responses.get(action);const value=await (typeof result==='function'?result():result);guard();return value}},clock:{now:()=>now}});
 return {catalog,calls,responses,query:defaultDocumentSearch(new Date(2026,9,15)),clock:value=>{now=value},relogin:()=>{epoch++}};
}
test('90 day/25 row defaults, 90s TTL, refresh and 20-query bound preserve catalog policy',async()=>{
 const f=fixture();assert.equal(f.query.pageSize,25);assert.equal(f.query.page,0);assert.equal(f.query.fromDate,'2026-07-17');
 await f.catalog.search(f.query);f.clock(89_999);await f.catalog.search(f.query);assert.equal(f.calls.length,1);
 f.clock(179_999);await f.catalog.search(f.query);assert.equal(f.calls.length,2);await f.catalog.search(f.query,{refresh:true});assert.equal(f.calls.length,3);
 for(let page=1;page<=20;page++)await f.catalog.search({...f.query,page});await f.catalog.search(f.query);assert.equal(f.calls.length,24);
});
test('stale surface and invalidation cannot repopulate a cache, and new account rereads',async()=>{
 const f=fixture(),held=gate();f.responses.set('search_documents',()=>held.promise);const reading=f.catalog.search(f.query);f.catalog.invalidate();held.resolve({items:[doc],total:1,pages:1});await reading;
 await f.catalog.search(f.query,{isCurrent:()=>false});await f.catalog.search(f.query);assert.equal(f.calls.length,3);f.relogin();await f.catalog.search(f.query);assert.equal(f.calls.length,4);
});
test('metadata joins verified exact identity, uses details only when missing and never pins null/failed reads',async()=>{
 const f=fixture(),held=gate();f.responses.set('status',()=>held.promise);const a=f.catalog.metadata('operation'),b=f.catalog.metadata('operation');held.resolve(status);assert.deepEqual(await a,await b);assert.equal(f.calls.length,1);
 f.catalog.invalidate();f.responses.set('status',{operation:{...status.operation,document_type:undefined,document_number:undefined}});const result=await f.catalog.metadata('operation');assert.equal(result.documentNumber,'4001');assert.deepEqual(f.calls.slice(-2).map(x=>x.action),['status','get_document']);
 f.catalog.invalidate();f.responses.set('status',{operation:{operation_id:'operation',state:'pending'}});assert.equal(await f.catalog.metadata('operation'),null);f.responses.set('status',status);assert.ok(await f.catalog.metadata('operation'));
 f.catalog.invalidate();f.responses.set('status',{operation:{...status.operation,operation_id:'foreign'}});await assert.rejects(f.catalog.metadata('operation'),invalid);f.responses.set('status',status);assert.ok(await f.catalog.metadata('operation'));
});
test('verified metadata and missing-field detail fallback match the original cache/read policy',async()=>{
 for(const missing of [false,true]){
  const f=fixture(),row={...status.operation};if(missing){delete row.document_number;delete row.document_type}f.responses.set('status',{operation:row});
  const calls=[],old=vm.runInNewContext(`(${original})`,{captureScope:()=>()=>{},operationMetadataCache:new Map(),backend:async(action)=>{calls.push(action);return action==='status'?{operation:row}:{document:doc}}});
  for(let n=0;n<2;n++)assert.deepEqual(JSON.parse(JSON.stringify(await f.catalog.metadata('operation'))),JSON.parse(JSON.stringify(await old('operation'))));
  assert.deepEqual(f.calls.map(row=>row.action),calls);
 }
});
test('disposal fences provider publication and drains held accepted metadata',async()=>{
 const f=fixture(),held=gate();f.responses.set('status',()=>held.promise);const request=f.catalog.metadata('operation');f.catalog.runtime.dispose();let drained=false;const drain=f.catalog.runtime.drain().then(()=>{drained=true});await Promise.resolve();assert.equal(drained,false);held.resolve(status);await assert.rejects(request,/Morning נעצר/);await drain;assert.equal(f.catalog.runtime.isPending(),false);assert.throws(()=>f.catalog.metadata('operation'));
});
for(const value of [null,[],{}, {items:{},total:0,pages:0},{items:[{...doc,amount:'30'}],total:1,pages:1},{items:[{...doc,status:'0'}],total:1,pages:1},{items:[{...doc,date:'2026-02-30'}],total:1,pages:1},{items:[doc],total:'1',pages:1},{items:[doc],total:1,pages:-1}])test('unknown Morning search rejects '+JSON.stringify(value),()=>assert.throws(()=>decodeMorningCatalogPage(value),invalid));
test('unknown detail/link/metadata evidence cannot authorize a foreign debt link',()=>{
 assert.throws(()=>decodeMorningCatalogDocument({document:doc},'foreign'),invalid);
 for(const operation of [{...status.operation,operation_id:'foreign'},{...status.operation,document_id:7},{...status.operation,document_type:'400'},{...status.operation,verified_at:'not-a-date'}])assert.throws(()=>decodeMorningCatalogMetadata({operation},'operation'),invalid);
 for(const url of ['http://example.test','javascript:alert(1)','https://user:password@example.test',null])assert.throws(()=>decodeMorningCatalogLink({url}),invalid);
});

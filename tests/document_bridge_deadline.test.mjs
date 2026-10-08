import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentBridgeClient} from '../shared/document-bridge-client.js';
import {createDomainsDocumentSearch} from '../netunim-kupa/site/assets/js/domains/documents/search-source.js';
import {documentPreviewErrorHtml,documentSearchErrorHtml} from '../netunim-kupa/site/assets/js/ui/document-search-error-view.js';

function fixture(){
  const jobs=new Map(),calls=[];let next=0;
  const client=createDocumentBridgeClient({tokenStore:{get:()=> 'paired',set:()=>{}},createAbortController:()=>new AbortController(),
    timers:{setTimeout:(run,delay)=>{jobs.set(++next,{run,delay});return next},clearTimeout:id=>jobs.delete(id)},
    fetchRequest:(url,options)=>{calls.push({url,options});return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}))},
  });
  return {client,jobs,calls,deadline:()=>[...jobs.values()][0].run()};
}

for(const [method,args] of [['recent',[]],['search',['query',{mode:'everything'}]],['search',['query',{mode:'content'}]],['preview',['D']],['previewFile',['D']],['matches',['D']]])test(`${method} deadline is a visible timeout rather than caller cancellation (${JSON.stringify(args)})`,async()=>{
  const f=fixture(),caller=new AbortController();
  const callArgs=method==='recent'?[{signal:caller.signal}]:[args[0],{...args[1],signal:caller.signal}];
  const pending=f.client[method](...callArgs),rejected=assert.rejects(pending,error=>error.code==='DOCUMENT_BRIDGE_TIMEOUT');
  f.deadline();await rejected;assert.equal(caller.signal.aborted,false);assert.equal(f.jobs.size,0);assert.equal(f.calls.length,1);
});

test('a Document Bridge timeout never silently falls back to Google Drive',async()=>{
  const f=fixture();let driveCalls=0;
  const source=createDomainsDocumentSearch({localBridge:f.client,googleDrive:{search:async()=>{driveCalls++;return {}},getToken:()=> 'drive'},userAgent:'Windows'});
  const pending=source.search('query'),rejected=assert.rejects(pending,error=>error.code==='DOCUMENT_BRIDGE_TIMEOUT');
  f.deadline();await rejected;assert.equal(driveCalls,0);assert.equal(source.provider,'everything');
});

for(const first of ['caller','deadline'])test(`first cancellation cause stays stable when ${first} wins`,async()=>{
  const f=fixture(),caller=new AbortController(),pending=f.client.search('query',{signal:caller.signal}),timer=[...f.jobs.values()][0].run;
  const rejected=assert.rejects(pending,error=>error.code===(first==='caller'?'DOCUMENT_BRIDGE_ABORTED':'DOCUMENT_BRIDGE_TIMEOUT'));
  if(first==='caller'){caller.abort();timer()}else{timer();caller.abort()}
  await rejected;assert.equal(f.jobs.size,0);
});

test('buffered success cannot escape an expired deadline',async()=>{
  let expire;const jobs=new Set();
  const client=createDocumentBridgeClient({tokenStore:{get:()=> 'paired',set:()=>{}},createAbortController:()=>new AbortController(),
    timers:{setTimeout:run=>{expire=run;jobs.add(1);return 1},clearTimeout:id=>jobs.delete(id)},
    fetchRequest:async()=>({ok:true,status:200,text:async()=>{expire();return '{"ok":true,"bridgeVersion":38}'}})});
  await assert.rejects(client.search('query'),error=>error.code==='DOCUMENT_BRIDGE_TIMEOUT');assert.equal(jobs.size,0);
});

test('an external transport AbortError retains the existing cancellation code',async()=>{
  const jobs=new Set(),client=createDocumentBridgeClient({tokenStore:{get:()=> 'paired',set:()=>{}},createAbortController:()=>new AbortController(),
    timers:{setTimeout:()=>{jobs.add(1);return 1},clearTimeout:id=>jobs.delete(id)},
    fetchRequest:async()=>{throw new DOMException('external cancellation','AbortError')}});
  await assert.rejects(client.search('query'),error=>error.code==='DOCUMENT_BRIDGE_ABORTED');assert.equal(jobs.size,0);
});

test('request error presentation escapes untrusted messages and diagnostic codes',()=>{
  const error={message:'<img src=x onerror=alert(1)>',code:'<script>alert(1)</script>'};
  for(const html of [documentSearchErrorHtml(error),documentPreviewErrorHtml(error),documentPreviewErrorHtml(error,{matches:true})]){
    assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script'));
    assert.equal(html.includes('<img'),false);assert.equal(html.includes('<script>'),false);
  }
});

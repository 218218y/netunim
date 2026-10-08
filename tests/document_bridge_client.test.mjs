import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentBridgeIntegration as createKupa} from '../netunim-kupa/site/assets/js/integrations/document-bridge.js';
import {createDocumentBridgeIntegration as createOrders} from '../netunim-orders/site/assets/js/integrations/document-bridge.js';
import {createDocumentBridgeClient} from '../shared/document-bridge-client.js';
import {createDomainsDocumentSearch} from '../shared/document-search/domains/documents/search-source.js';

const TOKEN_KEY='netunim_document_bridge_token_v1';
const LEGACY_KEYS=['netunim_orders_document_bridge_token_v1','netunim_kupa_document_bridge_token_v1'];
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function fixture(create){
  const values=new Map([[TOKEN_KEY,'paired-token']]),calls=[],timers=new Map();let timerId=0,reply=()=>new Response('{"ok":true,"bridgeVersion":38,"version":38}');
  const preferences={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  const platform={preferences,timers:{setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id},clearTimeout:id=>timers.delete(id)},fetchRequest:async(url,options)=>{calls.push({url,options});return reply(url,options)},createAbortController:()=>new AbortController()};
  return {api:create({platform}),calls,values,timers,preferences,reply:fn=>{reply=fn}};
}

for(const [app,create] of [['kupa',createKupa],['orders',createOrders]]){
  const matrix=[
    ['health',[],['/health','GET',undefined,2500]],
    ['status',[],['/status','GET',undefined,5000]],
    ['warm',[],['/documents/warm','POST',{},8000]],
    ['pdfIndexStatus',[],['/documents/pdf-index/status','GET',undefined,5000]],
    ['startPdfIndex',[],['/documents/pdf-index/start','POST',{},8000]],
    ['stopPdfIndex',[],['/documents/pdf-index/stop','POST',{},8000]],
    ['selectFolder',[],['/documents/select-folder','POST',{},125000]],
    ['recent',[],['/documents/recent','POST',{limit:150,scopePath:'',fileType:'all'},25000]],
    ['search',['query'],['/documents/search','POST',{query:'query',mode:'content',contentSearch:{},scopePath:'',fileType:'all',limit:150,offset:0,sort:{field:'',direction:''}},25000]],
    ['preview',['opaque-id'],['/documents/preview','POST',{id:'opaque-id'},12000]],
    ['matches',['opaque-id'],['/documents/matches','POST',{id:'opaque-id'},18000]],
    ['previewFile',['opaque-id'],['/documents/preview-file','POST',{id:'opaque-id'},35000]],
    ['nativePreview',['opaque-id',{x:10}],['/documents/native-preview','POST',{id:'opaque-id',geometry:{x:10}},12000]],
    ['moveNativePreview',[{x:20}],['/documents/native-preview/move','POST',{geometry:{x:20}},3500]],
    ['hideNativePreview',[],['/documents/native-preview/hide','POST',{},3500]],
    ['openDocument',['opaque-id'],['/documents/open','POST',{id:'opaque-id'},7000]],
    ['revealDocument',['opaque-id'],['/documents/reveal','POST',{id:'opaque-id'},7000]],
    ['deleteDocument',['opaque-id'],['/documents/delete','POST',{id:'opaque-id'},35000]],
  ];
  for(const [method,args,[path,verb,body,timeout]] of matrix)test(`${app} ${method} preserves endpoint, payload and deadline`,async()=>{
    const f=fixture(create);f.reply(url=>{
      assert.equal([...f.timers.values()][0].delay,url.endsWith('/health')?2500:timeout);
      return new Response(method==='previewFile'?'pdf-bytes':'{"ok":true,"version":38,"bridgeVersion":38}',{headers:{'Content-Type':method==='previewFile'?'application/pdf':'application/json'}});
    });
    const result=await f.api[method](...args),call=f.calls.at(-1);
    assert.equal(call.url,'http://127.0.0.1:8766'+path);assert.equal(call.options.method,verb);
    assert.deepEqual(call.options.body===undefined?undefined:JSON.parse(call.options.body),body);
    assert.equal(call.options.cache,'no-store');assert.equal(call.options.redirect,'error');
    assert.equal(call.options.headers.Authorization,method==='health'?undefined:'Bearer paired-token');
    assert.equal(f.timers.size,0);
    if(method==='previewFile'){assert.equal(result.type,'application/pdf');assert.equal(await result.text(),'pdf-bytes')}
    if(method==='selectFolder')assert.deepEqual(f.calls.map(call=>call.url),['http://127.0.0.1:8766/health','http://127.0.0.1:8766/documents/select-folder']);
  });
  for(const body of ['', '<html>proxy error</html>', 'null', '[]', '"text"'])test(`${app} rejects malformed successful Document Bridge response (${body||'empty'})`,async t=>{
    const f=fixture(create,t);f.reply(()=>new Response(body));
    await assert.rejects(f.api.status(),error=>error.code==='DOCUMENT_BRIDGE_RESPONSE_INVALID');
    assert.equal(f.timers.size,0);
  });
  for(const method of ['search','previewFile'])test(`${app} ${method} respects a signal cancelled before the request`,async t=>{
    const f=fixture(create,t),controller=new AbortController();controller.abort();
    await assert.rejects(f.api[method]('opaque-id',{signal:controller.signal}),error=>error.code==='DOCUMENT_BRIDGE_ABORTED');
    assert.equal(f.calls.length,0);assert.equal(f.timers.size,0);
  });
  test(`${app} anonymous health does not depend on paired-token storage`,async t=>{
    const f=fixture(create,t);f.preferences.getItem=()=>{throw new Error('preferences unavailable')};
    assert.equal((await f.api.health()).version,38);
    assert.equal(f.calls[0].options.headers.Authorization,undefined);
  });
  test(`${app} cancellation while decoding a preview HTTP error remains cancellation`,async t=>{
    const f=fixture(create,t),controller=new AbortController();
    const abort=async()=>{controller.abort();throw new DOMException('cancelled','AbortError')};
    f.reply(()=>({ok:false,status:403,text:abort,json:abort}));
    await assert.rejects(f.api.previewFile('opaque-id',{signal:controller.signal}),error=>error.code==='DOCUMENT_BRIDGE_ABORTED');
    assert.equal(f.timers.size,0);
  });
  test(`${app} pagination, sort and content parameters keep the local search contract`,async()=>{
    const f=fixture(create);
    await f.api.search('term',{mode:'everything',contentSearch:{wordMatch:'whole'},scopePath:'Y:\\Documents',fileType:'pdf',limit:99,offset:150.9,sort:{field:'name',direction:'asc'}});
    assert.deepEqual(JSON.parse(f.calls[0].options.body),{query:'term',mode:'everything',contentSearch:{wordMatch:'whole'},scopePath:'Y:\\Documents',fileType:'pdf',limit:99,offset:150,sort:{field:'name',direction:'asc'}});
    await f.api.search('term',{offset:-10});assert.equal(JSON.parse(f.calls[1].options.body).offset,0);
  });
  for(const status of [401,403,500])test(`${app} HTTP ${status} preserves safe diagnostics and never retries`,async()=>{
    const f=fixture(create);f.reply(()=>new Response(JSON.stringify({ok:false,code:'PROVIDER_ERROR',message:'provider failed',rootErrors:[{code:'INDEX_UNAVAILABLE'}]}),{status}));
    await assert.rejects(f.api.status(),error=>error.code==='PROVIDER_ERROR'&&error.httpStatus===status&&error.rootErrors[0].code==='INDEX_UNAVAILABLE');
    assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
  });
  test(`${app} HTTP error with a non-JSON body retains its HTTP code`,async()=>{
    const f=fixture(create);f.reply(()=>new Response('<html>proxy</html>',{status:503}));
    await assert.rejects(f.api.status(),error=>error.code==='HTTP_503'&&error.httpStatus===503);
  });
  for(const method of ['search','previewFile'])test(`${app} ${method} deadline covers response-body consumption`,async()=>{
    const f=fixture(create),started=deferred();f.reply((_url,{signal})=>{
      const consume=()=>{started.resolve();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')),{once:true}))};
      return {ok:true,status:200,text:consume,blob:consume};
    });
    const pending=f.api[method]('opaque-id');await started.promise;
    const rejected=assert.rejects(pending,error=>error.code==='DOCUMENT_BRIDGE_ABORTED');
    assert.equal(f.timers.size,1);[...f.timers.values()][0].fn();await rejected;assert.equal(f.timers.size,0);
  });
  test(`${app} independent requests cancel separately and detach caller listeners`,async t=>{
    const f=fixture(create),first=new AbortController(),second=new AbortController(),a=deferred(),b=deferred();
    const add=t.mock.method(first.signal,'addEventListener'),remove=t.mock.method(first.signal,'removeEventListener');
    f.reply((_url,{signal})=>{
      const operation=f.calls.length===1?a:b;
      signal.addEventListener('abort',()=>operation.reject(new DOMException('cancelled','AbortError')),{once:true});return operation.promise;
    });
    const one=f.api.search('one',{signal:first.signal}),two=f.api.search('two',{signal:second.signal});
    assert.equal(f.timers.size,2);const rejected=assert.rejects(one,error=>error.code==='DOCUMENT_BRIDGE_ABORTED');first.abort();await rejected;
    assert.equal(f.timers.size,1);assert.equal(f.calls[1].options.signal.aborted,false);
    b.resolve(new Response('{"ok":true,"bridgeVersion":38}'));await two;assert.equal(f.timers.size,0);
    assert.equal(add.mock.calls.length,1);assert.equal(remove.mock.calls.length,1);
    assert.equal(add.mock.calls[0].arguments[1],remove.mock.calls[0].arguments[1]);
    second.abort();assert.equal(f.calls[1].options.signal.aborted,false,'completed requests detach their cancellation listener');
  });
  test(`${app} cancelled buffered results cannot publish success`,async()=>{
    const f=fixture(create),controller=new AbortController();f.reply(()=>({ok:true,status:200,text:async()=>{controller.abort();return '{"ok":true,"bridgeVersion":38}'}}));
    await assert.rejects(f.api.search('query',{signal:controller.signal}),error=>error.code==='DOCUMENT_BRIDGE_ABORTED');assert.equal(f.timers.size,0);
  });
  test(`${app} explicit request recovers after an offline failure`,async()=>{
    const f=fixture(create);f.reply(()=>{throw new TypeError('offline')});
    await assert.rejects(f.api.status(),error=>error.code==='DOCUMENT_BRIDGE_UNAVAILABLE');assert.equal(f.timers.size,0);
    f.reply(()=>new Response('{"ok":true}'));assert.equal((await f.api.status()).ok,true);assert.equal(f.calls.length,2);
  });
  for(const key of LEGACY_KEYS)test(`${app} preserves installed pairing from ${key} across reconstruction`,async()=>{
    const f=fixture(create);f.values.delete(TOKEN_KEY);f.values.set(key,'legacy-token');
    assert.equal(f.api.getToken(),'legacy-token');assert.equal(f.values.get(TOKEN_KEY),'legacy-token');
    const reconstructed=fixture(create);reconstructed.values.clear();for(const [key,value] of f.values)reconstructed.values.set(key,value);
    await reconstructed.api.status();assert.equal(reconstructed.calls[0].options.headers.Authorization,'Bearer legacy-token');
    reconstructed.api.setToken('  replacement  ');assert.equal(reconstructed.api.getToken(),'replacement');
    assert.equal(LEGACY_KEYS.some(key=>reconstructed.values.has(key)),false);
    reconstructed.api.setToken('');assert.equal(reconstructed.api.getToken(),'');
  });
  test(`${app} failed legacy migration retains a usable token without deleting it`,async()=>{
    const f=fixture(create);f.values.delete(TOKEN_KEY);f.values.set(LEGACY_KEYS[0],'legacy-token');f.preferences.setItem=()=>{throw new Error('quota')};
    await f.api.status();assert.equal(f.calls[0].options.headers.Authorization,'Bearer legacy-token');assert.equal(f.values.get(LEGACY_KEYS[0]),'legacy-token');
    assert.throws(()=>f.api.setToken('replacement'),/quota/);assert.equal(f.values.get(LEGACY_KEYS[0]),'legacy-token');
  });
  test(`${app} unpaired authenticated calls do no network work`,async()=>{
    const f=fixture(create);f.values.clear();await assert.rejects(f.api.search('query'),error=>error.code==='DOCUMENT_BRIDGE_NOT_PAIRED');assert.equal(f.calls.length,0);assert.equal(f.timers.size,0);
  });
  for(const version of [37,39])test(`${app} version ${version} cannot serve a version-38 search`,async()=>{
    const f=fixture(create);f.reply(()=>new Response(JSON.stringify({ok:true,bridgeVersion:version})));
    await assert.rejects(f.api.search('query'),error=>error.code==='DOCUMENT_BRIDGE_UPGRADE_REQUIRED');assert.equal(f.calls.length,1);
  });
  test(`${app} old file-action endpoint retains its explicit upgrade requirement`,async()=>{
    const f=fixture(create);f.reply(()=>new Response('not found',{status:404}));
    await assert.rejects(f.api.revealDocument('opaque-id'),error=>error.code==='DOCUMENT_BRIDGE_UPGRADE_REQUIRED');assert.equal(f.calls.length,1);
  });
  for(const failure of ['malformed','cancelled'])test(`${app} ${failure} local search never becomes Drive fallback`,async()=>{
    const f=fixture(create),controller=new AbortController();let driveCalls=0;
    if(failure==='malformed')f.reply(()=>new Response('[]'));else controller.abort();
    const search=createDomainsDocumentSearch({localBridge:f.api,googleDrive:{search:async()=>{driveCalls++;return {results:[]}}},userAgent:'Windows'});
    await assert.rejects(search.search('query',{signal:controller.signal}),error=>error.code===(failure==='malformed'?'DOCUMENT_BRIDGE_RESPONSE_INVALID':'DOCUMENT_BRIDGE_ABORTED'));assert.equal(driveCalls,0);
  });
}

test('Document Bridge client rejects unbound ports during construction',()=>{
  assert.throws(()=>createDocumentBridgeClient({tokenStore:{get:()=>'',set:()=>{}},fetchRequest:()=>{},timers:{setTimeout:()=>{}},createAbortController:()=>{}}),/document_bridge_ports_required/);
});
test('constructing browser document integrations performs no I/O',t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,get:()=>assert.fail('storage during construction')});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage});t.mock.method(globalThis,'fetch',()=>assert.fail('network during construction'));
  for(const create of [createKupa,createOrders])assert.equal(typeof create().search,'function');
});

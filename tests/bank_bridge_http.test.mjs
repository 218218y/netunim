import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {httpFixture} from './bank_http_fixture.mjs';

const missing={ok:false,code:'NOT_FOUND',message:'נתיב Bank Bridge לא קיים'};

test('public status and diagnostic exports match frozen pre-refactor response fixtures',async t=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/bank-http-responses.json',import.meta.url),'utf8')),inputs=fixture.inputs;
  const f=await httpFixture(t,{readProfiles:async()=>structuredClone(inputs.creditProfiles),vault:{readCredentials:async()=>structuredClone(inputs.bankCredentials)},providerPorts:{
    readMeta:async()=>structuredClone(inputs.bankMeta),readCreditMeta:async()=>structuredClone(inputs.creditMeta),
    creditDiagnostics:{summary:async()=>[{stage:'fixture'}]},readCreditDataDiagnostic:async()=>structuredClone(inputs.creditData),readBankDiagnostic:async()=>structuredClone(inputs.bankDiagnostic)}});
  for(const [target,expected] of Object.entries(fixture.responses)){
    const actual=await f.request(target);assert.equal(actual.status,expected.status,target);assert.deepEqual(actual.data,expected.data,target);
  }
});

test('shutdown replies before teardown and retains the existing no-body route',async t=>{
  let stopped=0;const f=await httpFixture(t,{afterResponse:()=>{stopped++}});
  const response=await f.request('/shutdown',{method:'POST',body:'invalid JSON that shutdown does not consume'});
  assert.equal(response.status,200);assert.deepEqual(response.data,{ok:true});assert.equal(stopped,1);
});

test('closed admission rejects private work before reading bodies while allowing health and shutdown retry',async t=>{
  let reads=0,writes=0,stops=0;
  const f=await httpFixture(t,{vault:{readCredentials:async()=>{reads++;return null},writeCredentials:async()=>{writes++}},afterResponse:()=>{stops++}});
  f.api.operations.close();
  for(const [target,method] of [['/status','GET'],['/credentials','POST'],['/bank/diagnostics','GET'],['/bank/cheque-image/'+'a'.repeat(64),'GET']]){
    const response=await f.request(target,{method,body:'not JSON'});
    assert.equal(response.status,400);assert.equal(response.data.code,'BRIDGE_STOPPING');
  }
  assert.equal(reads,0);assert.equal(writes,0);
  assert.equal((await f.request('/credentials',{method:'POST',token:'wrong',body:'not JSON'})).status,401);
  assert.equal((await f.request('/health',{token:'wrong'})).status,200);
  assert.equal((await f.request('/unknown',{method:'OPTIONS'})).status,204);
  for(let n=0;n<2;n++)assert.deepEqual((await f.request('/shutdown',{method:'POST',body:'not JSON'})).data,{ok:true});
  assert.equal(stops,2);
});

test('public health/preflight and private token gates preserve existing Bank CORS policy',async t=>{
  let reads=0;const f=await httpFixture(t,{vault:{readCredentials:async()=>{reads++;return null}}});
  const health=await f.request('/health?probe=1',{token:'wrong'});
  assert.deepEqual(health.data,{ok:true,service:'netunim-kupa-bank-bridge',version:73,creditContractVersion:2});assert.equal(reads,0);
  const options=await f.request('/unknown',{method:'OPTIONS',token:'',body:'not JSON'});
  assert.equal(options.status,204);assert.equal(options.bytes.length,0);assert.equal(options.headers['access-control-allow-methods'],'GET,POST,DELETE,OPTIONS');assert.equal(options.headers['access-control-allow-private-network'],'true');
  for(const method of ['GET','POST','DELETE']){
    const response=await f.request('/credentials',{method,token:'wrong',body:'not JSON'});
    assert.equal(response.status,401);assert.deepEqual(response.data,{ok:false,code:'UNAUTHORIZED',message:'מפתח Bank Bridge שגוי'});
    assert.equal(response.headers['access-control-allow-origin'],'https://fixture.example');assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers.vary,'Origin');
  }
  assert.equal(reads,0);assert.deepEqual((await f.request('/health',{method:'POST'})).data,missing);
  assert.equal((await f.request('/health',{origin:''})).headers['access-control-allow-origin'],'*');
});

test('Bank routes preserve pathname/query semantics and only the credit v2 aliases',async t=>{
  const f=await httpFixture(t);
  for(const target of ['/status?ignored=true','/credit/status?ignored=true','/v2/credit/status?ignored=true'])assert.equal((await f.request(target)).status,200,target);
  for(const target of ['/status/','/v2/status','/credit/status/','/v2/credit/status/','/crediting/status'])assert.deepEqual((await f.request(target)).data,missing,target);
  for(const method of ['POST','DELETE','PUT'])assert.deepEqual((await f.request('/credit/status',{method,body:'not JSON'})).data,missing);
});

test('JSON boundary preserves invalid JSON, exact UTF8 byte limit and empty-body behavior',async t=>{
  let writes=0;const f=await httpFixture(t,{vault:{writeCredentials:async()=>{writes++}}});
  const invalid=await f.request('/credentials',{method:'POST',body:'{'});
  assert.equal(invalid.status,400);assert.deepEqual(invalid.data,{ok:false,code:'INVALID_JSON',stage:'',message:'JSON לא תקין',httpStatus:0,availableAccounts:[],accountRole:'',creditErrors:[]});
  assert.equal((await f.request('/credentials',{method:'POST'})).data.code,'MISSING_CREDENTIALS');
  const prefix='{"userCode":"fixture","password":"',suffix='"}',payload=prefix+'x'.repeat(32*1024-Buffer.byteLength(prefix+suffix))+suffix;
  assert.equal(Buffer.byteLength(payload),32768);assert.equal((await f.request('/credentials',{method:'POST',body:payload})).status,200);
  const utf8=Buffer.from('א'.repeat(32*1024));const oversized=await f.request('/credentials',{method:'POST',chunks:[utf8.subarray(0,32768),utf8.subarray(32768)]});
  assert.equal(oversized.status,413);assert.equal(oversized.data.code,'REQUEST_TOO_LARGE');assert.equal(writes,1);
});

test('private operation failures preserve the Bank error envelope and role metadata',async t=>{
  const failure=Object.assign(new Error('fixture failure'),{code:'FIXTURE',stage:'account',httpStatus:503,accountRole:'home',availableAccounts:[{branchNumber:'001',accountNumber:'000123'}],creditErrors:[{code:'ISSUER'}]});
  const f=await httpFixture(t,{vault:{readCredentials:async()=>{throw failure}}});
  const response=await f.request('/status');assert.equal(response.status,400);assert.deepEqual(response.data,{ok:false,code:'FIXTURE',stage:'account',message:'fixture failure',httpStatus:503,availableAccounts:failure.availableAccounts,accountRole:'home',creditErrors:failure.creditErrors});
});

test('cheque image routes preserve native bytes, private gate, retention and 64-hex IDs',async t=>{
  const key='a'.repeat(64),data=Buffer.from([0,1,255,65]);let reads=0,retained=true;
  const f=await httpFixture(t,{providerPorts:{readCachedChequeImage:async id=>{reads++;assert.equal(id,key);return {data,size:data.length,contentType:'image/png',eventDate:'20261012'}},chequeImageInRetention:()=>retained}});
  assert.equal((await f.request('/bank/cheque-image/'+key,{token:'wrong'})).status,401);assert.equal(reads,0);
  const binary=await f.request('/bank/cheque-image/'+key+'?ignored=true');assert.equal(binary.status,200);assert.deepEqual(binary.bytes,data);assert.equal(binary.headers['content-length'],'4');assert.equal(binary.headers['content-type'],'image/png');assert.equal(binary.headers['x-content-type-options'],'nosniff');assert.equal(binary.headers['cache-control'],'no-store');
  retained=false;const expired=await f.request('/bank/cheque-image/'+key);assert.equal(expired.status,404);assert.equal(expired.data.code,'CHEQUE_IMAGE_NOT_FOUND');
  for(const target of ['/bank/cheque-image/'+key.toUpperCase(),'/bank/cheque-image/../secret','/v2/bank/cheque-image/'+key])assert.deepEqual((await f.request(target)).data,missing);
  assert.equal(reads,2);
});

test('diagnostic route aliases preserve absent exports without leaking vault secrets',async t=>{
  const f=await httpFixture(t);
  for(const target of ['/credit/diagnostics','/v2/credit/diagnostics'])assert.deepEqual((await f.request(target)).data,{ok:true,contractVersion:2,events:[]});
  for(const target of ['/credit/data-diagnostics','/v2/credit/data-diagnostics','/bank/diagnostics']){
    const response=await f.request(target);assert.equal(response.status,200);assert.equal(response.data.available,false);assert.ok(response.data.message);assert.ok(!JSON.stringify(response.data).includes('synthetic'));
  }
});

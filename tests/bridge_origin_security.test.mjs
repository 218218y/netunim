import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createBankBridgeHttpHandler} from '../netunim-kupa/bank-bridge/http-handler.mjs';
import {createBankOriginPolicy} from '../netunim-kupa/bank-bridge/origin-policy.mjs';
import {createDocumentBridgeHttpHandler} from '../netunim-orders/document-bridge/http-handler.mjs';
import {DEFAULT_ALLOWED_ORIGINS} from '../netunim-orders/document-bridge/lib.mjs';

async function fixture(t,kind,originPolicy){
  let entries=0,tokenReads=0;
  const run=async()=>{entries++;return {ok:true}},route={readBody:true,response:'json',run};
  const config={allowedOrigins:[...DEFAULT_ALLOWED_ORIGINS]};
  const handler=kind==='bank'
    ?createBankBridgeHttpHandler({token:'synthetic-token',routes:{resolve:()=>route},health:()=>({ok:true}),admission:{assertAccepting(){}},originPolicy})
    :createDocumentBridgeHttpHandler({loadConfig:async()=>config,readToken:async()=>{tokenReads++;return 'synthetic-token'},
      routes:new Map([['POST /private',route]]),health:()=>({ok:true}),appendLog:async()=>{}});
  const server=http.createServer((req,res)=>Promise.resolve(handler(req,res)).catch(error=>{res.writeHead(500);res.end(error.message)}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=async(origin,{method='POST',token='synthetic-token',body='{}',path='/private'}={})=>{
    const response=await fetch(base+path,{method,headers:{...(origin===undefined?{}:{Origin:origin}),Authorization:'Bearer '+token},
      ...(method==='GET'||method==='OPTIONS'?{}:{body}),signal:AbortSignal.timeout(3000)});
    await response.text();return response;
  };
  return {request,config,counts:()=>({entries,tokenReads})};
}

test('arbitrary Bank origins cannot bypass Bearer admission, including destructive and binary route shapes',async t=>{
  const f=await fixture(t,'bank');
  for(const origin of ['https://unrelated.example','null','http://localhost:3000',undefined]){
    const preflight=await f.request(origin,{method:'OPTIONS',token:''});
    assert.equal(preflight.status,204);
    for(const [method,path] of [['POST','/balance'],['DELETE','/credentials'],['POST','/settings/import'],
      ['POST','/credit/reset'],['POST','/shutdown'],['GET','/bank/cheque-image/'+'a'.repeat(64)]]){
      const response=await f.request(origin,{method,path,token:'wrong',body:'not JSON'});
      assert.equal(response.status,401,`${origin} ${method} ${path}`);
    }
  }
  assert.equal(f.counts().entries,0);
});

test('Bank allowlist rejects foreign/null/spoofed origins before private entry, including a compromised token',async t=>{
  const f=await fixture(t,'bank',createBankOriginPolicy({version:1,mode:'allowlist'}));
  for(const origin of ['null','https://unrelated.example','https://bargig-kupa.pages.dev.unrelated.example',
    'https://bargig-furniture.com.unrelated.example','http://localhost.unrelated.example:3000',
    'https://bargig-kupa.pages.dev:8443','https://bargig-kupa.pages.dev/']){
    for(const [method,path] of [['OPTIONS','/private'],['GET','/health'],['DELETE','/credentials'],
      ['POST','/settings/import'],['POST','/credit/reset'],['POST','/shutdown'],['GET','/bank/cheque-image/'+'a'.repeat(64)]]){
      const response=await f.request(origin,{method,path,body:'not JSON'});
      assert.equal(response.status,403,`${origin} ${method} ${path}`);
      assert.equal(response.headers.has('access-control-allow-origin'),false);
      assert.equal(response.headers.has('access-control-allow-private-network'),false);
    }
  }
  assert.equal(f.counts().entries,0);
});

test('Bank opt-in allowlist retains deployment families, native clients and exact custom origins with Bearer admission',async t=>{
  const config={version:1,mode:'allowlist',allowedOrigins:['https://custom.example:8443']};
  const f=await fixture(t,'bank',createBankOriginPolicy(config));
  config.allowedOrigins.push('https://late-untrusted.example');
  const origins=['https://bargig-furniture.com','https://app.bargig-furniture.com','https://bargig-orders.pages.dev',
    'https://preview.bargig-orders.pages.dev','https://bargig-kupa.pages.dev','https://preview.bargig-kupa.pages.dev',
    'http://localhost:3000','http://127.0.0.1:8080','https://custom.example:8443',undefined];
  for(const origin of origins){
    const preflight=await f.request(origin,{method:'OPTIONS'});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get('access-control-allow-private-network'),'true');
    assert.equal((await f.request(origin,{token:'wrong',body:'not JSON'})).status,401);
    const response=await f.request(origin);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('access-control-allow-origin'),origin??'*');
  }
  assert.equal((await f.request('https://custom.example')).status,403,'custom ports are exact');
  assert.equal((await f.request('https://late-untrusted.example')).status,403,'captured policy is immutable');
  assert.equal(f.counts().entries,origins.length);
});

test('Bank reflected CORS deliberately supplies no origin barrier after a pairing-token compromise',async t=>{
  const f=await fixture(t,'bank'),origin='https://unrelated.example';
  const response=await f.request(origin);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('access-control-allow-origin'),origin);
  assert.equal(response.headers.get('access-control-allow-private-network'),'true');
  assert.equal(f.counts().entries,1);
});

test('Document origins reject foreign/null/suffix-spoofed sources before token and private entry',async t=>{
  const f=await fixture(t,'document');
  for(const origin of ['https://unrelated.example','null','https://bargig-furniture.com.unrelated.example',
    'https://bargig-orders.pages.dev.unrelated.example','http://localhost.unrelated.example:3000']){
    for(const method of ['OPTIONS','POST']){
      const response=await f.request(origin,{method});
      assert.equal(response.status,403,origin);
      assert.equal(response.headers.has('access-control-allow-origin'),false);
    }
  }
  assert.deepEqual(f.counts(),{entries:0,tokenReads:0});
});

test('Document default deployment families, local development and configured exact origins retain private authentication',async t=>{
  const f=await fixture(t,'document');
  const origins=['https://bargig-furniture.com','https://app.bargig-furniture.com','https://bargig-orders.pages.dev',
    'https://preview.bargig-orders.pages.dev','https://bargig-kupa.pages.dev','https://preview.bargig-kupa.pages.dev',
    'http://localhost:3000','http://127.0.0.1:8080',undefined];
  for(const origin of origins){
    assert.equal((await f.request(origin,{token:'wrong'})).status,401);
    assert.equal((await f.request(origin)).status,200);
  }
  f.config.allowedOrigins=['https://custom.example'];
  assert.equal((await f.request('https://custom.example')).status,200);
  assert.equal((await f.request(origins[0])).status,403);
  assert.equal(f.counts().entries,origins.length+1);
});

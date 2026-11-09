import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeFixture} from './edge_handler_fixture.mjs';
import {edgeOrigins,withEdgeOrigins} from '../netunim-orders/supabase/functions/_shared/edge-origins.js';

test('verified custom production domains work exactly without admitting sibling/preview origins',()=>{
  const origins=edgeOrigins();
  for(const origin of ['https://orders.bargig-furniture.com','https://kupa.bargig-furniture.com'])assert.ok(origins.has(origin));
  for(const origin of ['http://orders.bargig-furniture.com','https://orders.bargig-furniture.com.evil.example','https://preview.orders.bargig-furniture.com','https://preview.bargig-orders.pages.dev'])assert.equal(origins.has(origin),false);
});

for(const name of ['morning-documents','morning-expenses'])test(`${name}: actual entrypoint rejects foreign origins before auth, storage or provider actions`,async()=>{
  const f=await edgeFixture(name);
  for(const origin of ['https://evil.example','https://preview.bargig-orders.pages.dev','http://localhost:9000','null']){
    for(const method of ['POST','OPTIONS']){
      const r=await f.handler(new Request('https://example.supabase.co/functions/v1/'+name,{method,headers:{Origin:origin,Authorization:'Bearer test'},...(method==='POST'?{body:'{"action":"create"}'}:{})}));
      assert.equal(r.status,403);assert.equal(r.headers.has('Access-Control-Allow-Origin'),false);
    }
  }
  assert.equal(f.requests.length,0);assert.equal(f.operations.length,0);
  const r=await f.handler(new Request('https://example.supabase.co/functions/v1/'+name,{method:'OPTIONS',headers:{Origin:'https://bargig-orders.pages.dev'}}));
  assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'https://bargig-orders.pages.dev');
  assert.equal(r.headers.get('Vary'),'Origin');assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('explicit local origins are exact, wildcard/credential URLs are rejected and native calls still use the handler',async()=>{
  let calls=0;
  const handler=withEdgeOrigins(async()=>{calls++;return new Response('private',{status:401})},edgeOrigins('http://localhost:9000'));
  assert.equal((await handler(new Request('https://edge.test',{headers:{Origin:'http://localhost:9001'}}))).status,403);
  assert.equal((await handler(new Request('https://edge.test',{headers:{Origin:'http://localhost:9000'}}))).status,401);
  assert.equal((await handler(new Request('https://edge.test'))).status,401);
  assert.equal(calls,2);
  for(const value of ['https://*.pages.dev','https://trusted.example/path','https://user:password@trusted.example'])assert.throws(()=>edgeOrigins(value));
});

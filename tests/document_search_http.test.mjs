import {createBridgeReplacementCommand} from '../netunim-orders/document-bridge/bridge-replacement-command.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import fs from 'node:fs';
import {parse} from 'acorn';
import {createDocumentBridgeRoutes} from '../netunim-orders/document-bridge/http-routes.mjs';
import {createDocumentBridgeHttpHandler} from '../netunim-orders/document-bridge/http-handler.mjs';
import {BRIDGE_SERVICE,BRIDGE_VERSION} from '../netunim-orders/document-bridge/lib.mjs';
import {createEverythingSearchCoordinator} from '../netunim-orders/document-bridge/everything-search-coordinator.mjs';
import {deferred,row,serverFixture} from './document_search_server_fixture.mjs';

async function httpFixture(t,f,{afterResponse=()=>{}}={}) {
 const closing=deferred(),unused=async()=>{throw new Error('unexpected unrelated capability')},origin='https://bargig-furniture.com';
 const routes=createDocumentBridgeRoutes({service:{status:unused,warm:unused},maintenance:{status:unused,start:unused,stop:unused},
  search:{selectFolder:unused,search:f.search,recent:f.recent},preview:{document:unused,matches:unused,file:unused},
  nativePreview:{open:unused,move:unused,hide:unused},files:{open:unused,reveal:unused,delete:unused},shutdown:{prepare:()=>{const pending=f.shutdown();closing.resolve();return pending},afterResponse}});
 const handler=createDocumentBridgeHttpHandler({loadConfig:async()=>({allowedOrigins:[origin]}),readToken:async()=> 'test-key',routes,
  health:()=>({ok:true,service:BRIDGE_SERVICE,version:BRIDGE_VERSION,pid:0}),appendLog:async()=>{}});
 const server=http.createServer((req,res)=>handler(req,res).catch(error=>res.destroy(error)));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
 const port=server.address().port;
 async function request(target,body={}) {
  const response=await fetch(`http://127.0.0.1:${port}${target}`,{method:'POST',headers:{Authorization:'Bearer test-key',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
  return {status:response.status,data:await response.json()};
 }
 return {server,port,request,closing:closing.promise};
}

test('authenticated HTTP keeps accepted shutdown pending, rejects new search and releases no late result IDs',async t=>{
 const entered=deferred(),release=deferred(),f=serverFixture('current',{everything:async()=>{entered.resolve();return release.promise}});
 const h=await httpFixture(t,f);let stopped=false;
 const reading=h.request('/documents/search',{query:'document',limit:2});await entered.promise;
 const stopping=h.request('/shutdown').then(result=>{stopped=true;return result});
 await h.closing;
 assert.equal(f.context.shuttingDown,true);assert.equal(stopped,false);
 const denied=await h.request('/documents/recent',{limit:2});assert.equal(denied.status,503);assert.equal(denied.data.code,'DOCUMENT_SEARCH_DISPOSED');
 release.resolve({rows:[row(1)],elapsedMs:17});
 const [search,shutdown]=await Promise.all([reading,stopping]);assert.equal(search.status,503);assert.equal(search.data.code,'DOCUMENT_SEARCH_DISPOSED');
 assert.equal(shutdown.status,200);assert.equal(shutdown.data.ok,true);assert.equal(f.ids(),0);assert.deepEqual(f.logs,[]);
});

test('actual installer stop client grants the joined shutdown its own deadline before testing port release',async t=>{
 const entered=deferred(),release=deferred(),f=serverFixture('current',{everything:async()=>{entered.resolve();return release.promise}});
 let h;h=await httpFixture(t,f,{afterResponse:()=>h.server.close()});
 const reading=h.request('/documents/search',{query:'document',limit:1});await entered.promise;
 const deadlines=[];
 const replacement=createBridgeReplacementCommand({
  listener:{port:h.port,request:(options,listener)=>{const req=http.request(options,listener),set=req.setTimeout.bind(req);req.setTimeout=(ms,...args)=>{deadlines.push([options.path,ms]);return set(ms,...args)};return req}},
  token:{path:'unused-synthetic-path',read:async()=> 'test-key'},processes:{bridgeListenerPid:async()=>0,forceStopProcessTree:async()=>{throw Error('unexpected forced termination')},waitForProcessExit:async()=>{throw Error('unexpected unrelated process')}},runtime:{now:Date.now,setTimeout,log:async()=>{}},
 });
 const stop=replacement.stopExisting;
 const stopping=stop();
 await h.closing;
 assert.equal(f.context.shuttingDown,true);assert.deepEqual(deadlines.find(([target])=>target==='/shutdown'),['/shutdown',120000]);
 assert.equal(deadlines.some(([target])=>target==='/health'),true);
 release.resolve({rows:[row(1)],elapsedMs:17});await stopping;assert.equal((await reading).status,503);assert.equal(f.ids(),0);
});

for(const kind of ['search','proximity','recent'])test(`disconnect after a complete ${kind} request cancels the accepted ES read`,{timeout:5000},async t=>{
 const entered=deferred(),cancelled=deferred();let commands=0,published=0;
 const coordinator=createEverythingSearchCoordinator({
  configuration:{load:async()=>({searchTimeoutMs:1000})},
  session:{probe:async()=>({esPath:'inert',instance:'synthetic'}),invalidate:()=>{}},
  process:{run:async(_file,_args,{signal})=>{
   if(commands++)return {stdout:'[]'};
   assert.ok(signal instanceof AbortSignal);entered.resolve();
   return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{cancelled.resolve();reject(signal.reason)},{once:true}));
  }},
  pdf:{prepare:async()=>({partial:false}),search:()=>[]},
  publication:{prune:()=>{},publish:()=>{published++}},audit:{write:async()=>{}}
 });
 t.after(()=>coordinator.runtime.dispose());
 const h=await httpFixture(t,{search:coordinator.searchDocuments,recent:coordinator.recentDocuments,shutdown:async()=>({ok:true})});
 const target=kind==='recent'?'/documents/recent':'/documents/search';
 const body=JSON.stringify({query:'alpha beta',mode:'content',contentSearch:{matchMode:kind==='proximity'?'proximity':'phrase'}});
 const client=http.request({host:'127.0.0.1',port:h.port,path:target,method:'POST',headers:{Authorization:'Bearer test-key',Origin:'https://bargig-furniture.com','Content-Type':'application/json'}},()=>assert.fail('cancelled read published a response'));
 client.on('error',()=>{});client.end(body);await entered.promise;client.destroy();await cancelled.promise;
 const recovered=await h.request('/documents/recent');assert.equal(recovered.status,200);assert.equal(published,0);assert.equal(commands,2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for(const app of ['orders','kupa'])test(app+': intermittent deploy cannot mix a newer module into an older shell',async()=>{
  const site=new URL('../netunim-'+app+'/site/',import.meta.url),source=fs.readFileSync(new URL('service-worker.js',site),'utf8');
  const release=source.match(/const CACHE='([^']+)'/)[1],handlers={},entries=new Map();let skips=0,installMismatch=false;
  const urlOf=request=>new URL(typeof request==='string'?request:request.url,'https://app.test/').href;
  const response=(text,version=release)=>new Response(text,{headers:{'X-Netunim-Release':version}});
  const cache={
    async addAll(paths){for(const path of paths){const relative=path==='./'?'index.html':path.slice(2);entries.set(urlOf(path),response(fs.readFileSync(new URL(relative,site),'utf8'),installMismatch?'wrong':release))}},
    async match(request){return entries.get(urlOf(request))?.clone()},
    async put(request,value){entries.set(urlOf(request),value.clone())},
    async keys(){return [...entries.keys()].map(url=>new Request(url))},
  };
  let future=false,offline=false;
  const context={URL,Promise,Error,Response,Request,console,
    self:{location:{origin:'https://app.test',href:'https://app.test/service-worker.js'},clients:{claim:async()=>{}},skipWaiting:async()=>{skips++},addEventListener:(name,handler)=>{handlers[name]=handler}},
    caches:{open:async()=>cache,keys:async()=>[release],delete:async()=>true},
    fetch:async request=>{
      if(offline)throw Error('offline');
      const relative=new URL(urlOf(request)).pathname.slice(1)||'index.html';
      return future?response('export const incompatibleNextRelease=true;','next-release'):response(fs.readFileSync(new URL(relative,site),'utf8'));
    },
  };
  vm.runInNewContext(source,context);
  const installed=[];handlers.install({waitUntil:promise=>installed.push(promise)});await Promise.all(installed);
  const path='./assets/js/shared/spreadsheet-store.js',original=fs.readFileSync(new URL(path,site),'utf8');
  async function get(path){let result;const waits=[];
    handlers.fetch({request:{method:'GET',url:urlOf(path),mode:'cors'},respondWith:value=>{result=value},waitUntil:value=>waits.push(value)});
    const response=await result;await Promise.all(waits);return response;
  }
  future=true;
  assert.equal(await (await get(path)).text(),original,'new network module must fall back to the controlling release');
  offline=true;
  assert.equal(await (await get(path)).text(),original,'mismatched bytes must never poison the offline cache');
  future=false;offline=false;
  assert.equal(await (await get(path)).text(),original);
  future=true;entries.delete(urlOf(path));
  await assert.rejects(get(path),/offline_and_not_cached/,'no cached release must fail closed');
  context.self.registration={active:{}};
  const waiting=[];handlers.install({waitUntil:value=>waiting.push(value)});await Promise.all(waiting);
  assert.equal(skips,1,'an update must wait for the existing page to close');
  installMismatch=true;
  const broken=[];handlers.install({waitUntil:value=>broken.push(value)});
  await assert.rejects(Promise.all(broken),/shell_release_mismatch/);
});

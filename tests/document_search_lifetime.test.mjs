import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseEsJson} from '../netunim-orders/document-bridge/lib.mjs';
import {createDocumentResultRegistry} from '../netunim-orders/document-bridge/result-registry.mjs';
import {deferred,row,serverFixture} from './document_search_server_fixture.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function nativeRead(t) {
 const ready=deferred(),closed=deferred();let child,stdout='';
 const read=()=>{
  child=fork(fileURLToPath(new URL('./fixtures/document_search_worker.mjs',import.meta.url)),[],{silent:true,windowsHide:true});
  child.on('error',error=>{ready.reject(error);closed.reject(error)});
  child.stdout.on('data',data=>{stdout+=data});
  child.on('message',message=>{if(message?.kind==='ready')ready.resolve()});
  child.once('close',code=>{if(code!==0){closed.reject(new Error('synthetic child failed: '+code));return}try{closed.resolve({rows:parseEsJson(stdout),elapsedMs:19})}catch(error){closed.reject(error)}});
  return closed.promise;
 };
 t.after(async()=>{if(child&&child.exitCode===null){child.kill();await closed.promise.catch(()=>{})}});
 return {read,ready:ready.promise,closed:closed.promise,finish:stdout=>child.send({kind:'finish',stdout})};
}

test('original Promise.all releases a failed search while its accepted native reader is still running',async t=>{
 const child=await nativeRead(t),pdf=deferred(),f=serverFixture('baseline',{everything:child.read,prepare:()=>pdf.promise});
 const failure=Object.assign(new Error('first pdf read failure'),{code:'PDF_READ_FAILED'});
 let settled=false;const operation=f.search('document',2,'content');operation.then(()=>{settled=true},()=>{settled=true});
 await child.ready;pdf.reject(failure);await tick();assert.equal(settled,true);
 assert.equal(f.ids(),0);assert.deepEqual(f.logs,[]);await assert.rejects(operation,error=>error===failure);
 child.finish('');await child.closed;
});

test('failed current search joins its native sibling and preserves the first observed error over later malformed stdout',async t=>{
 const child=await nativeRead(t),pdf=deferred(),f=serverFixture('current',{everything:child.read,prepare:()=>pdf.promise});
 const failure=Object.assign(new Error('first pdf read failure'),{code:'PDF_READ_FAILED'});
 let settled=false;const operation=f.search('document',2,'content');operation.then(()=>{settled=true},()=>{settled=true});
 await child.ready;pdf.reject(failure);await tick();assert.equal(settled,false,'accepted native reader must finish before failure is reported');
 const rejected=assert.rejects(operation,error=>error===failure);child.finish('{"metadata":[]}');await rejected;
 assert.equal(settled,true);assert.equal(f.ids(),0);assert.deepEqual(f.logs,[]);
});

test('actual shutdown joins accepted native search, seals new search/recent commands and fences late opaque IDs',async t=>{
 const child=await nativeRead(t),f=serverFixture('current',{everything:child.read});
 const operation=f.search('document',2);const rejected=assert.rejects(operation,{code:'DOCUMENT_SEARCH_DISPOSED'});
 await child.ready;let done=false;const shutdown=f.shutdown().then(result=>{done=true;return result});
 await tick();assert.equal(done,false);assert.equal(f.context.shuttingDown,true);
 await assert.rejects(f.search('document',2),{code:'DOCUMENT_SEARCH_DISPOSED'});
 await assert.rejects(f.recent(2),{code:'DOCUMENT_SEARCH_DISPOSED'});
 child.finish('[{"Name":"synthetic.pdf","Path":"C:\\\\synthetic"}]');
 await rejected;assert.equal((await shutdown).ok,true);assert.equal(done,true);
 assert.equal(f.ids(),0);assert.deepEqual(f.logs,[]);assert.equal(f.calls.filter(item=>item[0]==='everything').length,1);
 await f.shutdown();
});

test('Everything failure also joins a pending PDF preparation and retains its earlier error',async()=>{
 const entered=deferred(),first=deferred(),second=deferred(),failure=Object.assign(new Error('Everything failed first'),{code:'ES_INVALID_JSON'});
 const f=serverFixture('current',{everything:()=>first.promise,prepare:()=>{entered.resolve();return second.promise}});
 let settled=false;const operation=f.search('document',2,'content');operation.then(()=>{settled=true},()=>{settled=true});
 await entered.promise;first.reject(failure);await tick();assert.equal(settled,false);
 const rejected=assert.rejects(operation,error=>error===failure);second.reject(new Error('later PDF error'));await rejected;
 assert.equal(f.ids(),0);assert.deepEqual(f.logs,[]);
});

test('shutdown between acceptance and execution starts no provider reads and still joins its accepted command',async()=>{
 const f=serverFixture(),operation=f.search('document',2),rejected=assert.rejects(operation,{code:'DOCUMENT_SEARCH_DISPOSED'});
 const shutdown=f.shutdown();await Promise.all([rejected,shutdown]);assert.deepEqual(f.calls,[]);assert.equal(f.ids(),0);
});

test('shutdown also joins a blocked audit and clears previously issued IDs before the audit releases',async()=>{
 const entered=deferred(),release=deferred();const f=serverFixture('current',{audit:async()=>{entered.resolve();await release.promise}});
 const operation=f.recent(2),rejected=assert.rejects(operation,{code:'DOCUMENT_SEARCH_DISPOSED'});await entered.promise;
 assert.equal(f.ids(),2);let done=false;const shutdown=f.shutdown().then(()=>{done=true});
 await tick();assert.equal(done,false);await assert.rejects(f.resolve('opaque-1'),{code:'DOCUMENT_RESULTS_DISPOSED'});
 release.resolve();await Promise.all([rejected,shutdown]);assert.equal(done,true);
});

test('native file stat, exact expiry and invalidation retain accepted read authority without reviving the registry',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'netunim-result-registry-'));
 assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const fullPath=path.join(dir,'synthetic.txt');await fs.writeFile(fullPath,'accepted file read');
 let time=1,id=0;const entered=deferred(),release=deferred();
 const registry=createDocumentResultRegistry({clock:{now:()=>time,ttlMs:10},identity:{next:()=>`native-${++id}`},files:{stat:async file=>{const stat=await fs.stat(file);entered.resolve();await release.promise;return stat}}});
 const context={query:'document',mode:'everything',contentSearch:{matchMode:'phrase',wordMatch:'partial',proximityWords:0}};
 const result=registry.publish(row(1,{fullPath}),context),accepted=registry.resolve(result.id);await entered.promise;
 assert.deepEqual(registry.invalidate(fullPath.toUpperCase()),[result.id]);registry.dispose();release.resolve();
 const captured=await accepted;assert.equal(captured.row.fullPath,fullPath);assert.equal(captured.stat.size,18);
 await assert.rejects(registry.resolve(result.id),{code:'DOCUMENT_RESULTS_DISPOSED'});
 assert.throws(()=>registry.publish(row(2,{fullPath}),context),{code:'DOCUMENT_RESULTS_DISPOSED'});
 time=12;assert.deepEqual(registry.invalidate(fullPath),[]);
});

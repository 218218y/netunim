import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createLazyGlobalDocumentSearch} from '../shared/lazy-global-document-search.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail});return {promise,resolve,reject}};
function fixture(create=createLazyGlobalDocumentSearch){
  const gate=deferred(),events=[];let changed,controls,loads=0,created=0,failBind=false;
  const view={bind:()=>{events.push('bind-heavy');if(failBind)throw Error('bind-failed')},dispose:()=>{events.push('dispose-heavy');return true},close:()=>events.push('close-heavy')};
  for(const name of ['open','toggle','renderResults','openResult','setMode','setFilter'])view[name]=(...args)=>events.push([name,...args]);
  const owner=create({load:async()=>{loads++;await gate.promise;return ()=>{created++;return view}},navigateItem:item=>events.push(['navigate',item]),
    subscribeAuthorization:callback=>{changed=callback;return ()=>events.push('unsubscribe')},
    platform:{bind:value=>{controls=value;events.push('bind-shell');return ()=>events.push('unbind-shell')},showLoading:()=>events.push('loading'),busy:value=>events.push(['busy',value]),hide:()=>events.push('hide'),invalidate:()=>events.push('invalidate'),showError:error=>events.push(['error',error.message])}});
  return {owner,gate,events,authChanged:()=>changed(),get controls(){return controls},get loads(){return loads},get created(){return created},failBind:value=>{failBind=value}};
}
test('startup binding and site navigation do not fetch or create search presentation',()=>{
  const f=fixture();f.owner.bind();f.owner.bind();f.owner.navigateItem('site');assert.equal(f.loads,0);assert.equal(f.created,0);assert.deepEqual(f.events,['bind-shell',['navigate','site']]);
});
test('concurrent first-use calls join import, create/bind once, then preserve synchronous loaded calls',async()=>{
  const f=fixture();f.owner.bind();const open=f.owner.open(),query=f.owner.renderResults('needle');await Promise.resolve();assert.equal(f.loads,1);assert.equal(f.created,0);
  f.gate.resolve();await Promise.all([open,query]);assert.equal(f.created,1);assert.equal(f.events.filter(x=>x==='bind-heavy').length,1);assert.ok(f.events.includes('unbind-shell'));
  assert.equal(typeof f.owner.renderResults('next'),'number');assert.equal(f.loads,1);
});
for(const cancel of ['close','dispose','account-change','account-A-B-A'])test(`${cancel} while import is held cannot create or open the old search`,async()=>{
  const f=fixture();f.owner.bind();const open=f.owner.open(),query=f.owner.renderResults('old account');await Promise.resolve();
  if(cancel==='close')f.owner.close();else if(cancel==='dispose')f.owner.dispose();else{f.authChanged();if(cancel==='account-A-B-A')f.authChanged()}
  f.gate.resolve();assert.equal(await open,false);assert.equal(await query,false);assert.equal(f.created,0);assert.equal(f.events.some(x=>Array.isArray(x)&&x[0]==='open'),false);
});
test('reopening after cancellation reuses the import with current authority',async()=>{
  const f=fixture();const stale=f.owner.open();await Promise.resolve();f.owner.close();const current=f.owner.open();f.gate.resolve();assert.equal(await stale,false);await current;assert.equal(f.created,1);assert.equal(f.loads,1);
});
test('a failed import is observed and explicit retry can create a fresh presentation',async()=>{
  let attempt=0;const f=fixture((options)=>createLazyGlobalDocumentSearch({...options,load:async()=>{attempt++;if(attempt===1)throw Error('offline-chunk');return ()=>({bind(){},open:()=>true,dispose:()=>true})}}));
  assert.equal(await f.owner.open(),false);assert.ok(f.events.some(x=>Array.isArray(x)&&x[0]==='error'));assert.equal(await f.owner.open(),true);assert.equal(attempt,2);
});
test('failed binding disposes the partial view and retains retry controls',async()=>{
  const f=fixture();f.owner.bind();f.failBind(true);const first=f.owner.open();f.gate.resolve();assert.equal(await first,false);assert.ok(f.events.includes('dispose-heavy'));assert.equal(f.events.includes('unbind-shell'),false);
  f.failBind(false);await f.owner.open();assert.equal(f.created,2);assert.ok(f.events.includes('unbind-shell'));
});
test('dispose is idempotent and cannot navigate or load again',()=>{
  const f=fixture();f.owner.bind();assert.equal(f.owner.dispose(),true);const count=f.events.length;assert.equal(f.owner.dispose(),false);assert.equal(f.owner.close(),false);assert.equal(f.owner.open(),false);assert.equal(f.owner.navigateItem('stale'),false);assert.equal(f.loads,0);assert.equal(f.events.length,count);
});
test('implementation mutation exposes late view creation after a cancelled import',async()=>{
  let source=fs.readFileSync('shared/lazy-global-document-search.js','utf8').replaceAll('\r\n','\n');
  const check='if(!current(captured))return false;';assert.ok(source.includes(check));source=source.replaceAll(check,'').replace('if(!current(captured)){created.dispose();return false}','').replace('if(!current(captured)){view.dispose();view=null;return false}','');
  const {createLazyGlobalDocumentSearch:unsafe}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const f=fixture(unsafe),pending=f.owner.open();await Promise.resolve();f.owner.close();f.gate.resolve();await pending;assert.equal(f.created,1);assert.ok(f.events.some(x=>Array.isArray(x)&&x[0]==='open'));
});

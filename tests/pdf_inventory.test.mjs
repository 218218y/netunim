import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfInventory} from '../netunim-orders/document-bridge/pdf-inventory.mjs';
const row=id=>({fullPath:`C:\\synthetic\\${id}.pdf`,extension:'pdf',isDirectory:false,id});
function fixture(pages,{counts=[pages.flat().length,pages.flat().length]}={}){
  const requests=[];let opened=0,countReads=0,stopped=false;
  const session={count:async()=>counts[Math.min(countReads++,counts.length-1)],page:async request=>{requests.push(request);return pages[request.offset/2]||[]}};
  const ports={open:async()=>{opened++;return session},isStopping:()=>stopped};
  return {inventory:createPdfInventory(ports,{pageSize:2}),ports,session,requests,opens:()=>opened,countReads:()=>countReads,stop:()=>{stopped=true}};
}
test('one captured session covers all pages and both full counts; exact IDs retain order',async()=>{
  const f=fixture([[row('a'),row('b')],[row('c')]]);const rows=await f.inventory.read({verifyComplete:true});assert.deepEqual(rows.map(row=>row.id),['a','b','c']);
  assert.equal(f.opens(),1);assert.equal(f.countReads(),2);assert.deepEqual(f.requests.map(value=>value.offset),[0,2]);
});
test('empty and exact page-sized inventories complete with an explicit terminal page',async()=>{
  const empty=fixture([[]]);assert.deepEqual(await empty.inventory.read({verifyComplete:true}),[]);
  const f=fixture([[row('a'),row('b')],[]]);assert.equal((await f.inventory.read({verifyComplete:true})).length,2);assert.deepEqual(f.requests.map(value=>value.offset),[0,2]);
});
test('incremental inventory retains its date scope and does not manufacture full count proof',async()=>{
  const f=fixture([[row('a')]]);await f.inventory.read({modifiedSince:'2026-10-11'});assert.equal(f.countReads(),0);assert.equal(f.requests[0].modifiedSince,'2026-10-11');
});
test('repeated pages and case-insensitive duplicate paths fail after bounded progress',async()=>{
  const f=fixture([[row('a'),row('b')],[row('a'),row('b')]]);await assert.rejects(f.inventory.read(),{code:'PDF_INVENTORY_CHANGED'});assert.equal(f.requests.length,2);
  const duplicates=fixture([[row('a'),{...row('a'),fullPath:'c:\\SYNTHETIC\\A.PDF'}]]);await assert.rejects(duplicates.inventory.read(),{code:'PDF_INVENTORY_CHANGED'});
});
test('a changed count, missing page content or growth cannot authorize reconciliation',async()=>{
  for(const counts of [[2,3],[3,3],[0,0]]){const f=fixture([[row('a')]],{counts});await assert.rejects(f.inventory.read({verifyComplete:true}),{code:'PDF_INVENTORY_CHANGED'})}
});
test('invalid counts and oversized/non-PDF pages fail closed',async()=>{
  for(const counts of [[null,null],[-1,-1],['2','2'],[1.5,1.5]]){const f=fixture([[row('a')]],{counts});await assert.rejects(f.inventory.read({verifyComplete:true}),{code:'PDF_INVENTORY_COUNT_INVALID'});assert.equal(f.requests.length,0)}
  for(const page of [[row('a'),row('b'),row('c')],[{...row('a'),extension:'txt'}],[{...row('a'),isDirectory:true}],[null]]){const f=fixture([page]);await assert.rejects(f.inventory.read(),{code:'PDF_INVENTORY_PAGE_INVALID'})}
});
for(const phase of ['open','first-count','page','last-count']){
  test(`abort during ${phase} cannot return a publishable inventory`,async()=>{
    const controller=new AbortController(),f=fixture([[row('a')]]),open=f.ports.open,count=f.session.count,page=f.session.page;
    if(phase==='open')f.ports.open=async()=>{const value=await open();controller.abort();return value};
    if(phase==='page')f.session.page=async request=>{const value=await page(request);controller.abort();return value};
    if(phase.includes('count')){let reads=0;f.session.count=async()=>{const value=await count();if(++reads===(phase==='first-count'?1:2))controller.abort();return value}}
    await assert.rejects(createPdfInventory(f.ports,{pageSize:2}).read({verifyComplete:true,signal:controller.signal}),{code:'ABORT_ERR'});
  });
}
test('runtime stopping is rechecked after awaits, independently of AbortSignal',async()=>{
  const f=fixture([[row('a')]]),page=f.session.page;f.session.page=async request=>{const result=await page(request);f.stop();return result};await assert.rejects(f.inventory.read(),{code:'ABORT_ERR'});
});
test('pre-aborted and invalid scopes do not open a provider session',async()=>{
  const f=fixture([[]]),controller=new AbortController();controller.abort();await assert.rejects(f.inventory.read({signal:controller.signal}),{code:'ABORT_ERR'});
  await assert.rejects(f.inventory.read({modifiedSince:'today'}),/scope_required/);await assert.rejects(f.inventory.read({modifiedSince:'2026-10-11',verifyComplete:true}),/scope_required/);assert.equal(f.opens(),0);
});
test('native source errors are preserved and do not cause hidden retry loops',async()=>{
  const f=fixture([[]]),error=Object.assign(new Error('IPC changed'),{code:'PDF_INVENTORY_SOURCE_CHANGED'});f.session.page=async()=>{throw error};await assert.rejects(f.inventory.read(),error);assert.equal(f.opens(),1);
});
test('invalid ports or page budgets are rejected before construction',()=>{
  const f=fixture([[]]);for(const pageSize of [0,-1,1.5,1001,Infinity])assert.throws(()=>createPdfInventory(f.ports,{pageSize}),/ports_required/);
  assert.throws(()=>createPdfInventory({...f.ports,open:null},{pageSize:2}),/ports_required/);
});

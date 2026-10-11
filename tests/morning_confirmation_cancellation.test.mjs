import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiModal} from '../netunim-orders/site/assets/js/ui/modal.js';

function fixture(t){
  const previous=new Map(['document','HTMLElement','requestAnimationFrame','setTimeout','clearTimeout'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),nodes=new Map(),timers=new Map();
  for(const id of ['confirmBackdrop','confirmDialog','confirmTitle','confirmMessage','confirmAccept','confirmCancel','confirmIcon']){
    const classes=new Set(),events=new Map();nodes.set('#'+id,{textContent:'',dataset:{},classList:{add:key=>classes.add(key),remove:key=>classes.delete(key),contains:key=>classes.has(key)},setAttribute(){},addEventListener:(event,run)=>events.set(event,run),click:()=>events.get('click')?.(),focus(){}});
  }
  const replacements={document:{querySelector:key=>nodes.get(key)||null,activeElement:null,addEventListener(){}},HTMLElement:class{},requestAnimationFrame:run=>run(),setTimeout:run=>{const id=Symbol();timers.set(id,run);return id},clearTimeout:id=>timers.delete(id)};
  for(const [key,value] of Object.entries(replacements))Object.defineProperty(globalThis,key,{value,configurable:true});
  t.after(()=>{for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}});
  return {modal:createUiModal({}),node:id=>nodes.get('#'+id),drain:()=>{for(const [id,run] of timers){timers.delete(id);run()}}};
}
test('revoked Morning confirmation resolves false and erases private text',async t=>{
  const f=fixture(t),owner=new AbortController(),pending=f.modal.confirmDialog('Morning','private customer A',{signal:owner.signal});
  assert.equal(f.node('confirmBackdrop').classList.contains('open'),true);owner.abort();
  assert.equal(await pending,false);assert.equal(f.node('confirmBackdrop').classList.contains('open'),false);assert.equal(f.node('confirmMessage').textContent,'');assert.equal(f.node('confirmTitle').textContent,'');
});
test('revoked queued confirmation cannot cancel another capability dialog',async t=>{
  const f=fixture(t),owner=new AbortController(),other=f.modal.confirmDialog('Other capability','keep this dialog');
  const pending=f.modal.confirmDialog('Morning','private customer A',{signal:owner.signal});owner.abort();assert.equal(await pending,false);
  assert.equal(f.node('confirmMessage').textContent,'keep this dialog');f.node('confirmAccept').click();assert.equal(await other,true);f.drain();assert.equal(f.node('confirmBackdrop').classList.contains('open'),false);
});
test('revoked active confirmation releases the queue without accepting it',async t=>{
  const f=fixture(t),owner=new AbortController(),pending=f.modal.confirmDialog('Morning','private customer A',{signal:owner.signal}),other=f.modal.confirmDialog('Other capability','new dialog');
  owner.abort();assert.equal(await pending,false);f.drain();assert.equal(f.node('confirmMessage').textContent,'new dialog');f.node('confirmAccept').click();assert.equal(await other,true);
});
test('an accepted action survives later visual cancellation and does not stop the next dialog',async t=>{
  const f=fixture(t),owner=new AbortController(),pending=f.modal.confirmDialog('Morning','private customer A',{signal:owner.signal});
  f.node('confirmAccept').click();assert.equal(await pending,true);const other=f.modal.confirmDialog('Other capability','new dialog');owner.abort();f.drain();assert.equal(f.node('confirmMessage').textContent,'new dialog');f.node('confirmCancel').click();assert.equal(await other,false);
});
test('an already revoked display never opens or queues a confirmation',async t=>{
  const f=fixture(t),owner=new AbortController();owner.abort();assert.equal(await f.modal.confirmDialog('Morning','private customer A',{signal:owner.signal}),false);assert.equal(f.node('confirmBackdrop').classList.contains('open'),false);f.drain();assert.equal(f.node('confirmMessage').textContent,'');
});

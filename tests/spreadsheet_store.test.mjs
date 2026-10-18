import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSpreadsheetStore} from '../shared/spreadsheet-store.js';

function fixture(create=createSpreadsheetStore){
  const data=new Map([['documents',new Map()],['drafts',new Map()]]);let opening;
  const database={close(){},transaction(names,mode){
    const copy=structuredClone(data);let aborted=false;
    const tx={error:null,abort(){aborted=true;setImmediate(()=>tx.onabort?.())},objectStore(name){return {
      put(value,key){copy.get(name).set(key,structuredClone(value))},
      delete(key){copy.get(name).delete(key)},
      get(key){const request={};queueMicrotask(()=>{request.result=structuredClone(copy.get(name).get(key));request.onsuccess?.()});return request},
    }}};
    setImmediate(()=>{if(aborted)return;if(mode==='readwrite')for(const name of names)data.set(name,copy.get(name));tx.oncomplete?.()});
    return tx;
  }};
  const store=create({indexedDB:{open(){opening={};return opening}},emergency:null});
  return {store,data,release(){opening.result=database;opening.onsuccess()}};
}

test('workbook and draft inputs are detached before waiting for IDB, with per-account keys',async()=>{
  const f=fixture(),record={working:{text:'accepted'}},patch={rowId:'r',columnId:'c',value:'accepted'};
  const writing=f.store.commit('A',record);record.working.text='late mutation';f.release();await writing;
  const journaling=f.store.journal('A',[patch]);patch.value='late mutation';await journaling;
  await f.store.commit('B',{working:{text:'private B'}});
  const saved=await f.store.load('A');
  assert.equal(saved.record.working.text,'accepted');assert.equal(saved.drafts[0].value,'accepted');
  assert.equal((await f.store.load('B')).record.working.text,'private B');
});
test('invalid journal values preserve old recovery data; absent emergency storage never ACKs a draft',async()=>{
  const f=fixture(),writing=f.store.commit('A',{before:true});f.release();await writing;
  const patch={rowId:'r',columnId:'c',value:'accepted'};await f.store.journal('A',[patch]);
  for(const invalid of [{...patch,value:12},{...patch,generation:Infinity},{...patch,updatedAt:[]},null])
    await assert.rejects(f.store.journal('A',[invalid]),/drafts_invalid/);
  assert.equal((await f.store.load('A')).drafts[0].value,'accepted');
  assert.equal(f.store.saveEmergency('A',[patch]),false);
  assert.equal(f.store.saveEmergency('A',[]),true);
  f.data.get('drafts').set('A',[{unrecognized:'recover me'}]);
  await assert.rejects(f.store.journal('A',[patch]),/drafts_invalid/);
  assert.deepEqual((await f.store.load('A')).drafts,[{unrecognized:'recover me'}]);
});
test('bounded emergency writes retain the prior recovery text on quota and invalid input',()=>{
  let text='old recovery',quota=false;
  const store=createSpreadsheetStore({emergency:{getItem:()=>text,setItem(_key,value){if(quota)throw Error('quota');text=value},removeItem(){text=null}}});
  const patch={rowId:'r',columnId:'c',value:'accepted'};
  quota=true;assert.equal(store.saveEmergency('A',[patch]),false);assert.equal(text,'old recovery');
  quota=false;
  assert.equal(store.saveEmergency('A',[{...patch,value:'x'.repeat(65537)}]),false);assert.equal(text,'old recovery');
  assert.equal(store.saveEmergency('A',[{...patch,value:null}]),false);assert.equal(text,'old recovery');
  assert.equal(store.saveEmergency('A',[patch]),true);assert.deepEqual(store.readEmergency('A'),[patch]);
});
test('real implementation mutations reproduce the original deferred-input race',async()=>{
  const original=readFileSync(new URL('../shared/spreadsheet-store.js',import.meta.url),'utf8');
  for(const [safe,unsafe] of [
    ['const captured=structuredClone(record);','const captured=record;'],
    ['const captured=captureDrafts(patches);','const captured=patches;'],
  ]){
    assert.ok(original.includes(safe));
    const source=original.replace(safe,unsafe).replace("'./indexed-db-connection.js'",JSON.stringify(new URL('../shared/indexed-db-connection.js',import.meta.url).href));
    const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    const f=fixture(module.createSpreadsheetStore),record={text:'accepted'};
    const writing=f.store.commit('A',record);record.text='mutated';f.release();await writing;
    const patch={rowId:'r',columnId:'c',value:'accepted'},journaling=f.store.journal('A',[patch]);patch.value='mutated';await journaling;
    const saved=await f.store.load('A');
    assert.equal(safe.includes('record')?saved.record.text:saved.drafts[0].value,'mutated');
  }
});

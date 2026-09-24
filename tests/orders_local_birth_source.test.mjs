import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';
import {STORAGE_KEY,LOCAL_STORE,LOCAL_STATE_KEY} from '../netunim-orders/site/assets/js/state/constants.js';

function fakeLegacyStorage({browserState=null,durableState=null,outbox=null,failRead=false}={}){
  const priorStorage=globalThis.localStorage,priorIdb=globalThis.indexedDB;
  const values=new Map(),records=new Map(),writes=[];
  if(browserState!==null)values.set(STORAGE_KEY,JSON.stringify(browserState));
  if(durableState!==null)records.set(`${LOCAL_STORE}:${LOCAL_STATE_KEY}`,{payload:durableState});
  if(outbox!==null)records.set('sync:orders-outbox-v3',outbox);
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes.push(key);values.set(key,value)},removeItem:key=>{writes.push(key);values.delete(key)}};
  const db={objectStoreNames:{contains:()=>true},createObjectStore:()=>{},close:()=>{},transaction:name=>({objectStore:()=>({get:key=>{const request={};queueMicrotask(()=>{if(failRead){request.error=Error('IDB read failed');request.onerror?.()}else{request.result=records.get(`${name}:${key}`);request.onsuccess?.()}});return request}})})};
  globalThis.indexedDB={open:()=>{const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.()});return request}};
  const browser=createStorageBrowser({model:{state:{}},files:{},session:{},normalizeState:value=>value,prepareState:value=>value,prepareCloudState:value=>value});
  return {browser,writes,restore(){if(priorStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=priorStorage;if(priorIdb===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=priorIdb}};
}

test('Orders local birth reads the newest legacy snapshot without repairing either V1 store',async()=>{
  const fixture=fakeLegacyStorage({browserState:{_meta:{localSnapshotSeq:2},checks:[{id:'old'}]},durableState:{_meta:{localSnapshotSeq:3},checks:[{id:'new'}]}});
  try{
    const source=await fixture.browser.readLegacyLocalMigrationSource();
    assert.equal(source.snapshotSeq,3);
    assert.equal(source.mainState.checks[0].id,'new');
    assert.equal(await fixture.browser.verifyLegacyCloudCleanReadOnly(),true);
    assert.deepEqual(fixture.writes,[]);
  }finally{fixture.restore()}
});

test('Orders local birth stops on equally sequenced divergent legacy copies',async()=>{
  const fixture=fakeLegacyStorage({browserState:{_meta:{localSnapshotSeq:3},checks:[{id:'a'}]},durableState:{_meta:{localSnapshotSeq:3},checks:[{id:'b'}]}});
  try{await assert.rejects(fixture.browser.readLegacyLocalMigrationSource(),/source_diverged/);assert.deepEqual(fixture.writes,[])}finally{fixture.restore()}
});

test('Orders local birth treats IndexedDB failure as unknown, never as an empty source',async()=>{
  const fixture=fakeLegacyStorage({browserState:{_meta:{localSnapshotSeq:3},checks:[{id:'a'}]},failRead:true});
  try{await assert.rejects(fixture.browser.readLegacyLocalMigrationSource(),/IDB read failed/);await assert.rejects(fixture.browser.verifyLegacyCloudCleanReadOnly(),/IDB read failed/);assert.deepEqual(fixture.writes,[])}finally{fixture.restore()}
});

test('Orders fresh local birth does not create a legacy IndexedDB database while probing',async()=>{
  const priorStorage=globalThis.localStorage,priorIdb=globalThis.indexedDB;
  let opens=0,writes=0;
  globalThis.localStorage={getItem:()=>null,setItem:()=>{writes++}};
  globalThis.indexedDB={databases:async()=>[],open:()=>{opens++;throw Error('old database should remain absent')}};
  try{
    const browser=createStorageBrowser({model:{state:{}},files:{},session:{},normalizeState:value=>value,prepareState:value=>value,prepareCloudState:value=>value});
    const source=await browser.readLegacyLocalMigrationSource();
    assert.equal(source.sourceFound,false);
    assert.equal(await browser.verifyLegacyCloudCleanReadOnly(),true);
    assert.equal(opens,0);assert.equal(writes,0);
  }finally{if(priorStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=priorStorage;if(priorIdb===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=priorIdb}
});

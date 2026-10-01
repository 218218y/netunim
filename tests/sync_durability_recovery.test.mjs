import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageBrowser as ordersBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';
import {createStorageBrowser as kupaBrowser} from '../netunim-kupa/site/assets/js/storage/browser.js';
import {INITIAL_STATE as ORDERS_INITIAL_STATE} from '../netunim-orders/site/assets/js/state/constants.js';

const clone=structuredClone,noop=()=>{};
function stores(){
  const ls=new Map(),db=new Map();let failIDB=false;
  globalThis.localStorage={get length(){return ls.size},getItem:k=>ls.get(k)??null,setItem:(k,v)=>ls.set(k,v),removeItem:k=>ls.delete(k)};
  globalThis.indexedDB={open:()=>{const request={};queueMicrotask(()=>{if(failIDB){request.error=Error('idb unavailable');request.onerror?.();return}request.result={close:noop,transaction:store=>{const tx={objectStore:()=>({put:(value,key)=>{queueMicrotask(()=>{db.set(store+key,clone(value));tx.oncomplete?.()})},get:key=>{const r={};queueMicrotask(()=>{r.result=clone(db.get(store+key));r.onsuccess?.()});return r},delete:key=>{queueMicrotask(()=>{db.delete(store+key);tx.oncomplete?.()})}})};return tx}};request.onsuccess?.()});return request}};
  return {ls,db,set failIDB(value){failIDB=value}};
}

for(const app of ['orders','kupa'])test(`${app} browser persistence fails closed when the V2 journal is unavailable`,()=>{
  const store=stores(),files={},session={localSnapshotSeq:0,cloudRevision:0,dbRevision:0,storageProtocolBlocked:false};
  const storageV2={cutoverActive:false,persist:()=>({handled:false,reason:'not-ready'})};
  const browser=app==='orders'
    ?ordersBrowser({storageV2,model:{state:structuredClone(ORDERS_INITIAL_STATE)},session,files,normalizeState:x=>x})
    :kupaBrowser({storageV2,model:{state:{}},session,files});
  assert.throws(()=>app==='orders'?browser.localSnapshot():browser.persistImmediateBrowserSnapshot(),/storage_v2_write_unavailable/);
  assert.equal(store.ls.size,0);assert.equal(store.db.size,0);
});

for(const app of ['orders','kupa'])test(`${app} exposes the V2 commit promise while emergency durability is pending`,async()=>{
  const store=stores(),files={},session={localSnapshotSeq:0,cloudRevision:0,dbRevision:0,storageProtocolBlocked:false};
  let settle;const committed=new Promise(resolve=>{settle=resolve});
  const storageV2={cutoverActive:true,persist:()=>({handled:true,emergencyDurable:false,committed})};
  const browser=app==='orders'
    ?ordersBrowser({storageV2,model:{state:structuredClone(ORDERS_INITIAL_STATE)},session,files,normalizeState:x=>x})
    :kupaBrowser({storageV2,model:{state:{}},session,files});
  assert.equal(app==='orders'?browser.localSnapshot():browser.persistImmediateBrowserSnapshot(),false);
  assert.equal(files.storageV2CommitPromise,committed);assert.equal(store.ls.size,0);assert.equal(store.db.size,0);
  settle();await committed;
});

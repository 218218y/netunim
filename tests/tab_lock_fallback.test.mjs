import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageTabLock as createOrdersLock} from '../netunim-orders/site/assets/js/storage/tab-lock.js';
import {createStorageTabLock as createKupaLock} from '../netunim-kupa/site/assets/js/storage/tab-lock.js';

class StorageMock{
  #items=new Map();
  getItem(key){return this.#items.has(key)?this.#items.get(key):null}
  setItem(key,value){this.#items.set(key,String(value))}
  removeItem(key){this.#items.delete(key)}
}

async function exercise(factory){
  const prior={navigator:globalThis.navigator,window:globalThis.window,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,BroadcastChannel:globalThis.BroadcastChannel};
  const pagehide=[];
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});
  Object.defineProperty(globalThis,'localStorage',{value:new StorageMock(),configurable:true});
  Object.defineProperty(globalThis,'BroadcastChannel',{value:undefined,configurable:true});
  Object.defineProperty(globalThis,'window',{value:{addEventListener(type,callback){if(type==='pagehide')pagehide.push(callback)}},configurable:true});
  try{
    Object.defineProperty(globalThis,'sessionStorage',{value:new StorageMock(),configurable:true});
    const first={primaryTab:true,primaryTabReady:false},firstLock=factory({tab:first,showSecondaryTabGuard(){}});
    assert.equal(await firstLock.acquirePrimaryTabLock(),true);
    Object.defineProperty(globalThis,'sessionStorage',{value:new StorageMock(),configurable:true});
    const second={primaryTab:true,primaryTabReady:false},secondLock=factory({tab:second,showSecondaryTabGuard(){}});
    assert.equal(await secondLock.acquirePrimaryTabLock(),false);
    assert.equal(first.primaryTab,true);
    assert.equal(second.primaryTab,false);
    assert.equal(first.primaryTabReady&&second.primaryTabReady,true);
  }finally{
    for(const callback of pagehide)callback();
    for(const [key,value] of Object.entries(prior))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  }
}

test('Orders fallback elects one writer when Web Locks is unavailable',()=>exercise(createOrdersLock));
test('Kupa fallback elects one writer when Web Locks is unavailable',()=>exercise(createKupaLock));

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginLocalSiteResetNavigation,
  clearCurrentOriginStorage,
  installLocalSiteResetPeerListener,
  localSiteResetPageUrl,
} from '../shared/local-site-reset.js';

class FakeBroadcastChannel {
  static instances=[];
  constructor(name){this.name=name;this.messages=[];this.listeners=new Map();FakeBroadcastChannel.instances.push(this)}
  postMessage(message){this.messages.push(message)}
  addEventListener(name,listener){this.listeners.set(name,listener)}
  removeEventListener(name){this.listeners.delete(name)}
  close(){this.closed=true}
  emit(name,data){this.listeners.get(name)?.({data})}
}

function fakeStorage(entries={a:'1'}){
  const values=new Map(Object.entries(entries));
  return {
    get length(){return values.size},
    clear(){values.clear()},
  };
}

function fakeIndexedDb(initialNames=[]){
  const names=new Set(initialNames),deleted=[];
  return {
    deleted,
    async databases(){return [...names].map(name=>({name,version:1}))},
    deleteDatabase(name){
      deleted.push(name);
      const request={onsuccess:null,onerror:null,onblocked:null,error:null};
      queueMicrotask(()=>{names.delete(name);request.onsuccess?.()});
      return request;
    },
  };
}

test('clearCurrentOriginStorage wipes every discoverable origin store and browser shell',async()=>{
  const local=fakeStorage({owner:'x',pending:'y'}),session=fakeStorage({tab:'z'});
  const idb=fakeIndexedDb(['netunim-storage-v2','unknown-origin-db']);
  const deletedCaches=[],cacheNames=new Set(['shell-a','shell-b']);
  const cacheStorage={keys:async()=>[...cacheNames],delete:async name=>{deletedCaches.push(name);cacheNames.delete(name);return true}};
  let unregisterCount=0;
  const registrations=[
    {active:true,async unregister(){unregisterCount++;this.active=false;return true}},
    {active:true,async unregister(){unregisterCount++;this.active=false;return true}},
  ];
  const serviceWorker={getRegistrations:async()=>registrations.filter(item=>item.active)};

  const result=await clearCurrentOriginStorage({
    localStorageObject:local,
    sessionStorageObject:session,
    indexedDb:idb,
    cacheStorage,
    serviceWorker,
  });

  assert.equal(local.length,0);
  assert.equal(session.length,0);
  assert.deepEqual(deletedCaches,['shell-a','shell-b']);
  assert.equal(unregisterCount,2);
  assert.equal(result.serviceWorkers,2);
  assert.equal(result.caches,2);
  assert.ok(idb.deleted.includes('netunim-storage-v2'));
  assert.ok(idb.deleted.includes('unknown-origin-db'),'unknown DBs on the app origin are also wiped');
  assert.deepEqual(await idb.databases(),[]);
});

test('reset navigation parks peer tabs before moving the primary tab to reset-only page',async()=>{
  FakeBroadcastChannel.instances=[];
  const replaced=[];
  const locationObject={href:'https://orders.example.test/index.html',replace:value=>replaced.push(value)};
  await beginLocalSiteResetNavigation({locationObject,BroadcastChannelImpl:FakeBroadcastChannel,setTimeoutImpl:fn=>fn()});
  assert.deepEqual(FakeBroadcastChannel.instances[0].messages,[{type:'prepare-local-site-reset'}]);
  assert.equal(replaced[0],'https://orders.example.test/reset-local.html');
});

test('peer listener leaves the live app and parks on a non-storage reset page',()=>{
  FakeBroadcastChannel.instances=[];
  const replaced=[];
  const locationObject={href:'https://kupa.example.test/index.html',replace:value=>replaced.push(value)};
  const dispose=installLocalSiteResetPeerListener({locationObject,BroadcastChannelImpl:FakeBroadcastChannel});
  const channel=FakeBroadcastChannel.instances[0];
  channel.emit('message',{type:'prepare-local-site-reset'});
  assert.equal(replaced[0],'https://kupa.example.test/reset-local.html?peer=1');
  dispose();
  assert.equal(channel.closed,true);
});

test('reset page URL remains inside the current application origin',()=>{
  assert.equal(localSiteResetPageUrl({href:'https://app.example.test/index.html'}),'https://app.example.test/reset-local.html');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRestoreGroupKeys,RESTORE_GROUP_NAMESPACES} from '../shared/restore-group-keys.js';
import {createRestoreGroupStore} from '../shared/restore-groups.js';
import {createStorageBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';

test('every supported restore key builder satisfies the same storage admission contract without renaming persisted keys',()=>{
  for(const namespace of Object.values(RESTORE_GROUP_NAMESPACES)){
    const keys=createRestoreGroupKeys(namespace);
    assert.equal(keys.current,namespace+':current');
    assert.equal(keys.archive('group'),namespace+':archive:group');
    assert.equal(keys.server('account'),namespace+':current:server:account');
    for(const key of [keys.current,keys.archive('group'),keys.server('account')])assert.equal(keys.read(key),key);
    assert.notEqual(keys.server('A'),keys.server('B'));
  }
});
test('restore key admission rejects other namespaces, business outboxes and incomplete server/archival identities',()=>{
  const keys=createRestoreGroupKeys(RESTORE_GROUP_NAMESPACES.orders);
  for(const key of [undefined,null,true,1,{},[],{toString:()=>keys.current},
    'orders-outbox-v3','shared-checks-outbox-v3','kupa.restore.group.v1:current',
    'orders.restore.group.v1:current:other:A','orders.restore.group.v1:current:server:',
    'orders.restore.group.v1:current:server:  ','orders.restore.group.v1:archive:',
    'orders.restore.group.v1:archive:  '])assert.throws(()=>keys.read(key),/storage_restore_group_key_required/);
  for(const value of ['', ' ',null,false,undefined]){
    assert.throws(()=>keys.server(value),/storage_restore_group_key_required/);
    assert.throws(()=>keys.archive(value),/storage_restore_group_key_required/);
  }
});
test('the real Orders store/browser connection can check an account pending restore with no local database',async t=>{
  const prior=globalThis.indexedDB;let inventories=0,opens=0;
  globalThis.indexedDB={databases:async()=>{inventories++;return []},open:()=>{opens++;throw Error('unexpected database creation')}};
  t.after(()=>{if(prior===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=prior});
  const browser=createStorageBrowser({model:{state:{}},files:{},session:{},prepareCloudState:()=>({}),normalizeState:value=>value});
  const store=createRestoreGroupStore({localKey:RESTORE_GROUP_NAMESPACES.orders,storage:{getItem:()=>null},
    put:(...args)=>browser.idbSyncPut(...args),get:(...args)=>browser.idbSyncGet(...args),remove:(...args)=>browser.idbSyncDelete(...args)});
  assert.equal(await store.loadPending(),null);
  assert.equal(await store.loadServerPending('11111111-1111-4111-8111-111111111111'),null);
  assert.deepEqual({inventories,opens},{inventories:2,opens:0});
  for(const key of ['orders-outbox-v3','orders.restore.group.v1:current:server:']){
    for(const run of [()=>browser.idbSyncGet(key),()=>browser.idbSyncPut(key,{}),()=>browser.idbSyncDelete(key)])
      await assert.rejects(run(),/storage_restore_group_key_required/);
  }
  assert.deepEqual({inventories,opens},{inventories:2,opens:0});
});

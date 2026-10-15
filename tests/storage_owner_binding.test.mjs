import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageOwnerBinding,STORAGE_OWNER_UNBOUND,storageOwnerCacheKey} from '../shared/storage-owner.js';

import {fakeStorage,fakeDb} from './storage_owner_ports.mjs';

const session=owner=>owner?{user:{id:owner}}:null;

test('durable storage owner survives auth loss and LocalStorage loss',async()=>{
  const db=fakeDb(),storage=fakeStorage();
  const first=createStorageOwnerBinding({app:'orders',db,storage,now:()=> '2026-09-23T10:00:00.000Z'});
  assert.equal(first.current(),STORAGE_OWNER_UNBOUND);
  await assert.rejects(first.hydrate({legacyOwner:()=> 'account-A'}),/hydrate_options_invalid/);
  await first.hydrate({initialOwner:()=> 'account-A'});
  assert.equal(first.current(),'account-A');assert.equal(first.assertSessionOwner(session('account-A')),true);
  assert.equal(first.assertAuthenticatedOwner('account-A'),true);
  assert.throws(()=>first.assertSessionOwner(null),error=>error.code==='storage_owner_reauth_required');
  assert.throws(()=>first.assertAuthenticatedOwner('account-B'),error=>error.code==='storage_owner_auth_mismatch');
  storage.removeItem(storageOwnerCacheKey('orders'));
  const restarted=createStorageOwnerBinding({app:'orders',db,storage,now:()=> '2026-09-23T10:05:00.000Z'});
  await restarted.hydrate({initialOwner:()=> null});
  assert.equal(restarted.current(),'account-A');
  assert.equal(storage.getItem(storageOwnerCacheKey('orders')),'account-A','IDB repairs the synchronous cache, never the other way around');
});

test('a forged or stale owner cache cannot override IndexedDB authority',async()=>{
  const db=fakeDb(),storage=fakeStorage({[storageOwnerCacheKey('kupa')]:'account-B'});
  db.seedBinding('kupa',{version:1,app:'kupa',owner:'account-A',generation:3,source:'handoff:account-switch',createdAt:'x',updatedAt:'y'});
  const owner=createStorageOwnerBinding({app:'kupa',db,storage});await owner.hydrate({initialOwner:()=> 'account-B'});
  assert.equal(owner.current(),'account-A');assert.equal(storage.getItem(storageOwnerCacheKey('kupa')),'account-A');
  assert.throws(()=>owner.assertSessionOwner(session('account-B')),error=>error.code==='storage_owner_auth_mismatch'&&error.storageOwner==='account-A'&&error.authOwner==='account-B');
  assert.equal(owner.assertSessionOwner(session('account-A')),true);
});

test('a cache without a durable binding is ignored during first bootstrap',async()=>{
  const db=fakeDb(),storage=fakeStorage({[storageOwnerCacheKey('orders')]:'forged-account'});
  const owner=createStorageOwnerBinding({app:'orders',db,storage,now:()=> 't'});await owner.hydrate({initialOwner:()=> 'real-account'});
  assert.equal(owner.current(),'real-account');assert.equal(db.snapshot().bindings[0][1].source,'session-bootstrap');
});

test('owner handoff is restartable and activates the target atomically before final completion',async()=>{
  const db=fakeDb(),storage=fakeStorage();let primary=true,id=0;
  const make=()=>createStorageOwnerBinding({app:'orders',db,storage,primary:()=>primary,operationId:()=>`H${++id}`,now:()=>`T${id}`});
  let owner=make();await owner.hydrate({initialOwner:()=> 'account-A'});
  const started=await owner.beginHandoff('account-B',{intent:'account-switch'});assert.equal(started.phase,'freezing-source');assert.equal(owner.current(),'account-A');assert.equal(owner.writable,false);
  owner=make();await owner.hydrate({initialOwner:()=> 'account-B'});assert.equal(owner.current(),'account-A');assert.equal(owner.status().handoff.phase,'freezing-source');
  for(const phase of ['freezing-source','source-settled','target-authenticated'])await owner.advanceHandoff(phase,{proof:phase});
  assert.equal(owner.current(),'account-A');assert.equal(owner.status().handoff.phase,'target-recovered');
  await owner.activateHandoff();assert.equal(owner.current(),'account-B');assert.equal(owner.writable,false);assert.equal(owner.status().handoff.phase,'target-active');assert.equal(owner.status().binding.generation,2);
  owner=make();await owner.hydrate({initialOwner:()=> 'account-A'});assert.equal(owner.current(),'account-B');assert.equal(owner.locked,true);assert.equal(owner.status().handoff.phase,'target-active','restart retains the in-progress target activation');
  await owner.completeHandoff();assert.equal(owner.current(),'account-B');assert.equal(owner.writable,true);
  const restarted=make();await restarted.hydrate({initialOwner:()=> 'account-A'});assert.equal(restarted.current(),'account-B');assert.equal(restarted.locked,false);
});

test('handoff cannot be started from a secondary tab or completed out of phase',async()=>{
  const db=fakeDb(),storage=fakeStorage();let primary=false;
  const owner=createStorageOwnerBinding({app:'kupa',db,storage,primary:()=>primary,operationId:()=> 'H'});await owner.hydrate({initialOwner:()=> 'A'});
  await assert.rejects(owner.beginHandoff('B',{intent:'account-switch'}),/primary_required/);
  primary=true;await owner.beginHandoff('B',{intent:'account-switch'});await assert.rejects(owner.completeHandoff(),/phase_invalid/);
});

test('V2 handoff activation clears a superseded local adoption reservation',async()=>{
  const db=fakeDb(),owner=createStorageOwnerBinding({app:'orders',db,storage:fakeStorage(),primary:()=>true,operationId:()=> 'handoff-1'});
  await owner.hydrate({initialOwner:()=>null});
  await owner.reserveLocalAdoption('account-B',{intent:'upload-local'});
  await owner.beginHandoff('account-B',{intent:'upload-local'});
  for(const phase of ['freezing-source','source-settled','target-authenticated'])await owner.advanceHandoff(phase);
  await owner.activateHandoff();
  assert.equal(owner.current(),'account-B');
  assert.equal(owner.status().binding.pendingAdoption,null);
  assert.equal(db.snapshot().bindings[0][1].pendingAdoption,null);
});


test('prepared local account adoption is atomic, durable and cannot be used for account A to B',async()=>{
  const db=fakeDb(),storage=fakeStorage();let id=0;
  const make=()=>createStorageOwnerBinding({app:'orders',db,storage,primary:()=>true,operationId:()=>`L${++id}`,now:()=>`T${id}`});
  let owner=make();await owner.hydrate({initialOwner:()=> null});assert.equal(owner.current(),'local');
  await assert.rejects(owner.adoptPreparedLocalOwner('account-B',{intent:'load-account'}),/storage_owner_local_adoption_not_reserved/);
  await owner.reserveLocalAdoption('account-B',{intent:'load-account'});assert.equal(owner.current(),'local');assert.equal(owner.writable,true);
  assert.equal(owner.assertAuthenticatedOwner('account-B'),true);assert.throws(()=>owner.assertAuthenticatedOwner('account-C'),error=>error.code==='storage_owner_local_adoption_auth_mismatch'&&error.requiredOwner==='account-B');
  owner=make();await owner.hydrate({initialOwner:()=> null});assert.equal(owner.current(),'local','reservation survives restart without switching owner');assert.equal(owner.assertAuthenticatedOwner('account-B'),true);
  const adopted=await owner.adoptPreparedLocalOwner('account-B',{intent:'load-account',proof:{mainRevision:7,sharedRevision:9}});
  assert.equal(adopted.owner,'account-B');assert.equal(owner.writable,true);assert.equal(owner.locked,false);
  const durable=db.snapshot();assert.equal(durable.bindings[0][1].source,'prepared-local:load-account');assert.equal(durable.bindings[0][1].pendingAdoption,null);assert.equal(durable.handoffs[0][1].phase,'complete');assert.deepEqual(durable.handoffs[0][1].preparationProof,{mainRevision:7,sharedRevision:9});
  owner=make();await owner.hydrate({initialOwner:()=> null});assert.equal(owner.current(),'account-B');
  assert.equal((await owner.adoptPreparedLocalOwner('account-B',{intent:'load-account'})).owner,'account-B','retry is idempotent after the atomic adoption');
  await assert.rejects(owner.adoptPreparedLocalOwner('account-C',{intent:'load-account'}),/storage_owner_handoff_required/);
});

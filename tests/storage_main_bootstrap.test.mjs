import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageJournal} from '../shared/storage-journal.js';
import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';
import {STORAGE_SCHEMAS} from '../shared/storage-shadow.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const clone=structuredClone;
function emptyOrders(){return {
  version:4,businessName:'ניהול הזמנות',suppliers:[],transactions:[],customerDebts:[],customerOrders:[],serviceCalls:[],inventoryItems:[],inventoryCategoryOrder:[],inventoryEvents:[],warehouseOrders:[],notes:[],checks:[],importAudit:{},stage2Audit:{},
}}
function validateOrders(state){
  for(const key of ['suppliers','transactions','customerDebts','customerOrders','serviceCalls','inventoryItems','inventoryEvents','warehouseOrders','notes','checks'])assert.ok(Array.isArray(state[key]),key);
  assert.ok(Array.isArray(state.inventoryCategoryOrder));
}
function makeRuntime(db,owner='account-A',mode=()=> 'primary'){
  return createStorageV2Runtime({
    app:'orders',owner:()=>owner,primary:()=>true,mode,validate:validateOrders,
    createJournal:args=>createStorageJournal({...args,db,emergency:emergencyStore()}),
  });
}
function cloudProjection(state){const value=clone(state);delete value.checks;return value}

test('Main non-empty first-cloud bootstrap is empty base plus one durable pending V2 operation',async()=>{
  const db=memoryDb(),initial=emptyOrders(),current=emptyOrders();
  current.notes=[{id:'N1',content:'local only'}];
  current.suppliers=[{id:'S1',name:'supplier'}];
  current.inventoryCategoryOrder=['raw','hardware'];
  current.importAudit={source:'local-file'};

  const runtime=makeRuntime(db);
  const recovered=await runtime.initializeUploadLocalCloudHead(initial,current,{cloudState:cloudProjection(initial),validateBase:()=>{}});
  assert.equal(recovered.seq,1);
  assert.deepEqual(recovered.state,current);
  const cloud=await runtime.cloudState({validateBase:()=>{}});
  assert.equal(cloud.base.revision,0);
  assert.equal(cloud.base.ackSeq,0);
  assert.deepEqual(cloud.base.state,cloudProjection(initial));
  assert.equal(cloud.pending,true);
  assert.equal(cloud.seq,1);

  const restarted=makeRuntime(db);
  const afterRestart=await restarted.recover();
  assert.equal(afterRestart.seq,1);
  assert.deepEqual(afterRestart.state,current);
  const pendingAfterRestart=await restarted.cloudState({validateBase:()=>{}});
  assert.equal(pendingAfterRestart.pending,true);
  assert.equal(pendingAfterRestart.base.ackSeq,0);
});


test('Main first-cloud bootstrap also supports data already bound to the same account owner',async()=>{
  const db=memoryDb(),initial=emptyOrders(),current=emptyOrders();current.notes=[{id:'N-account',content:'owned locally by account-A'}];
  const runtime=makeRuntime(db,'account-A');
  const recovered=await runtime.initializeFirstCloudHead(initial,current,{sourceOwner:'account-A',cloudState:cloudProjection(initial),validateBase:()=>{}});
  assert.equal(recovered.seq,1);assert.deepEqual(recovered.state,current);
  const cloud=await runtime.cloudState({validateBase:()=>{}});assert.equal(cloud.base.revision,0);assert.equal(cloud.base.ackSeq,0);assert.equal(cloud.pending,true);
  const stored=await db.load('account-A:orders');assert.equal(stored.journal[0].data.appMetadata.migrationIntent,'upload-owner');assert.equal(stored.journal[0].data.appMetadata.sourceOwner,'account-A');assert.equal(stored.journal[0].data.appMetadata.targetOwner,'account-A');
});

test('Main first-cloud bootstrap never permits account A to seed account B implicitly',async()=>{
  const runtime=makeRuntime(memoryDb(),'account-B');
  await assert.rejects(runtime.initializeFirstCloudHead(emptyOrders(),emptyOrders(),{sourceOwner:'account-A',cloudState:cloudProjection(emptyOrders()),validateBase:()=>{}}),/target_required/);
});
test('Main first-cloud bootstrap rejects local target owner and requires an explicit empty cloud base',async()=>{
  const current=emptyOrders();current.notes=[{id:'N1'}];
  await assert.rejects(makeRuntime(memoryDb(),'local').initializeUploadLocalCloudHead(emptyOrders(),current,{cloudState:cloudProjection(emptyOrders()),validateBase:()=>{}}),/target_required/);
  await assert.rejects(makeRuntime(memoryDb()).initializeUploadLocalCloudHead(emptyOrders(),current),/cloud_base_required/);
});

test('pre-cutover preparation may initialize/recover V2 but freezes normal mutations and never promotes legacy fallback implicitly',async()=>{
  const db=memoryDb(),legacy=emptyOrders();legacy.notes=[{id:'legacy-only'}];
  const preparing=()=> 'preparing';
  const before=makeRuntime(db,'account-A',preparing);
  assert.equal(await before.recover(legacy,{snapshotSeq:4}),null);
  assert.equal((await db.load('account-A:orders')).checkpoints,null);
  await assert.rejects(async()=>before.persist(legacy,{operations:[{type:'set',field:'businessName',value:'blocked'}]}),/preparation_locked/);
  const current=emptyOrders();current.notes=[{id:'N1'}];
  await before.initializeFirstCloudHead(emptyOrders(),current,{sourceOwner:'account-A',cloudState:cloudProjection(emptyOrders()),validateBase:()=>{}});
  const restarted=makeRuntime(db,'account-A',preparing),recovered=await restarted.recover(legacy,{snapshotSeq:99});
  assert.deepEqual(recovered.state,current);assert.equal(recovered.source,'v2');
  assert.throws(()=>restarted.persist(current,{operations:[{type:'set',field:'businessName',value:'still blocked'}]}),/preparation_locked/);
});

test('Main bootstrap initialization is idempotent only for the same durable bootstrap operation',async()=>{
  const db=memoryDb(),current=emptyOrders();current.notes=[{id:'N1'}];
  const first=makeRuntime(db);
  const options={sourceOwner:'account-A',cloudState:cloudProjection(emptyOrders()),validateBase:()=>{},appMetadata:{bootstrapOperationId:'group:main'}};
  await first.initializeFirstCloudHead(emptyOrders(),current,options);
  const restarted=makeRuntime(db);
  const replay=await restarted.initializeFirstCloudHead(emptyOrders(),current,options);
  assert.equal(replay.seq,1);assert.deepEqual(replay.state,current);
  const foreign=makeRuntime(db);
  await assert.rejects(foreign.initializeFirstCloudHead(emptyOrders(),current,{...options,appMetadata:{bootstrapOperationId:'different:main'}}),/existing_head_mismatch/);
});


test('Main bootstrap atomically promotes an identical shadow checkpoint instead of deleting it',async()=>{
  const db=memoryDb(),current=emptyOrders();current.notes=[{id:'shadow-N1',content:'already observed'}];
  const shadow=createStorageJournal({owner:'account-A:orders',schema:STORAGE_SCHEMAS.orders,validate:validateOrders,db,emergency:emergencyStore()});
  await shadow.install(current,{expectedEpoch:null,appMetadata:{storageRole:'shadow',migrationIntent:'shadow-observation',sourceOwner:'account-A'}});
  const before=await db.load('account-A:orders');assert.equal(before.bases,null);assert.equal(before.metadata.seq,0);

  const runtime=makeRuntime(db,'account-A',()=> 'preparing');
  const recovered=await runtime.initializeFirstCloudHead(emptyOrders(),current,{sourceOwner:'account-A',cloudState:cloudProjection(emptyOrders()),validateBase:()=>{},appMetadata:{bootstrapOperationId:'shadow-promote:main'}});
  assert.equal(recovered.seq,1);assert.deepEqual(recovered.state,current);
  const stored=await db.load('account-A:orders');assert.equal(stored.journal.length,1);assert.equal(stored.bases.data.revision,0);assert.equal(stored.metadata.seq,1);
  const cloud=await runtime.cloudState({validateBase:()=>{}});assert.equal(cloud.pending,true);assert.equal(cloud.base.ackSeq,0);
});

test('Main bootstrap refuses to promote a shadow checkpoint whose business state diverged',async()=>{
  const db=memoryDb(),shadowState=emptyOrders(),current=emptyOrders();shadowState.notes=[{id:'shadow-old'}];current.notes=[{id:'source-new'}];
  const shadow=createStorageJournal({owner:'account-A:orders',schema:STORAGE_SCHEMAS.orders,validate:validateOrders,db,emergency:emergencyStore()});
  await shadow.install(shadowState,{expectedEpoch:null,appMetadata:{storageRole:'shadow',migrationIntent:'shadow-observation',sourceOwner:'account-A'}});
  const runtime=makeRuntime(db,'account-A',()=> 'preparing');
  await assert.rejects(runtime.initializeFirstCloudHead(emptyOrders(),current,{sourceOwner:'account-A',cloudState:cloudProjection(emptyOrders()),validateBase:()=>{},appMetadata:{bootstrapOperationId:'shadow-mismatch:main'}}),/existing_head_mismatch/);
  const stored=await db.load('account-A:orders');assert.equal(stored.bases,null);assert.equal(stored.journal.length,0);assert.deepEqual(stored.checkpoints.data.state,shadowState);
});

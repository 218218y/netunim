import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageOwnerBinding,STORAGE_OWNER_UNBOUND,storageOwnerCacheKey} from '../shared/storage-owner.js';

function fakeStorage(initial={}){
  const values=new Map(Object.entries(initial));
  return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),dump:()=>Object.fromEntries(values)};
}
function fakeDb(){
  const bindings=new Map(),handoffs=new Map();
  return {
    async readOwnerBinding(app){return bindings.has(app)?structuredClone(bindings.get(app)):null},
    async readOwnerHandoff(app){return handoffs.has(app)?structuredClone(handoffs.get(app)):null},
    async initializeOwnerBinding(app,owner,{source,at}){
      const existing=bindings.get(app);if(existing){if(existing.owner!==owner)throw Error('storage_owner_binding_conflict');return structuredClone(existing)}
      const row={version:1,app,owner,generation:1,source,createdAt:at,updatedAt:at};bindings.set(app,row);return structuredClone(row);
    },
    async reserveLocalOwnerTarget(app,targetOwner,{id,intent,at}){const binding=bindings.get(app);if(!binding)throw Error('storage_owner_binding_missing');if(binding.owner===targetOwner&&!binding.pendingAdoption)return structuredClone(binding);if(binding.owner!=='local')throw Error('storage_owner_handoff_required');const pending=binding.pendingAdoption;if(pending){if(pending.targetOwner===targetOwner&&pending.intent===intent)return structuredClone(binding);throw Error('storage_owner_local_adoption_reserved')}const next={...binding,pendingAdoption:{id,targetOwner,intent,createdAt:at,updatedAt:at},updatedAt:at};bindings.set(app,next);return structuredClone(next)},
    async adoptPreparedLocalOwner(app,targetOwner,{id,intent,proof,at}){const binding=bindings.get(app),existing=handoffs.get(app);if(!binding)throw Error('storage_owner_binding_missing');if(binding.owner===targetOwner&&(!existing||existing.phase==='complete'))return {binding:structuredClone(binding),handoff:existing?structuredClone(existing):null};if(binding.owner!=='local')throw Error('storage_owner_handoff_required');if(existing&&existing.phase!=='complete')throw Error('storage_owner_handoff_pending');const reservation=binding.pendingAdoption;if(!reservation||reservation.targetOwner!==targetOwner||reservation.intent!==intent)throw Error('storage_owner_local_adoption_not_reserved');const nextBinding={...binding,owner:targetOwner,generation:binding.generation+1,source:`prepared-local:${intent}`,pendingAdoption:null,updatedAt:at},complete={version:1,id,app,sourceOwner:'local',targetOwner,intent,phase:'complete',preparationProof:structuredClone(proof),reservationId:reservation.id,createdAt:reservation.createdAt||at,activatedAt:at,completedAt:at,updatedAt:at};bindings.set(app,nextBinding);handoffs.set(app,complete);return {binding:structuredClone(nextBinding),handoff:structuredClone(complete)}},
    async beginOwnerHandoff(app,row){const binding=bindings.get(app),existing=handoffs.get(app);if(!binding)throw Error('storage_owner_binding_missing');if(existing&&existing.phase!=='complete')throw Error('storage_owner_handoff_pending');if(binding.owner!==row.sourceOwner)throw Error('storage_owner_handoff_invalid');handoffs.set(app,structuredClone(row));return structuredClone(row)},
    async advanceOwnerHandoff(app,id,fromPhase,toPhase,patch){const row=handoffs.get(app);if(!row||row.id!==id||row.phase!==fromPhase)throw Error('storage_owner_handoff_changed');const next={...row,...structuredClone(patch),phase:toPhase};handoffs.set(app,next);return structuredClone(next)},
    async activateOwnerHandoff(app,id,targetOwner,{at}){const row=handoffs.get(app),binding=bindings.get(app);if(!row||!binding||row.id!==id||row.phase!=='target-recovered'||row.sourceOwner!==binding.owner||row.targetOwner!==targetOwner)throw Error('storage_owner_handoff_changed');const nextBinding={...binding,owner:targetOwner,generation:binding.generation+1,source:`handoff:${row.intent}`,updatedAt:at},active={...row,phase:'target-active',activatedAt:at,updatedAt:at};bindings.set(app,nextBinding);handoffs.set(app,active);return {binding:structuredClone(nextBinding),handoff:structuredClone(active)}},
    async completeOwnerHandoff(app,id,targetOwner,{at}){const row=handoffs.get(app),binding=bindings.get(app);if(!row||!binding||row.id!==id||row.phase!=='target-active'||binding.owner!==targetOwner||row.targetOwner!==targetOwner)throw Error('storage_owner_handoff_changed');const complete={...row,phase:'complete',completedAt:at,updatedAt:at};handoffs.set(app,complete);return {binding:structuredClone(binding),handoff:structuredClone(complete)}},
    seedBinding(app,row){bindings.set(app,structuredClone(row))},seedHandoff(app,row){handoffs.set(app,structuredClone(row))},snapshot(){return {bindings:structuredClone([...bindings]),handoffs:structuredClone([...handoffs])}}
  };
}
const session=owner=>owner?{user:{id:owner}}:null;

test('durable storage owner survives auth loss and LocalStorage loss',async()=>{
  const db=fakeDb(),storage=fakeStorage();
  const first=createStorageOwnerBinding({app:'orders',db,storage,now:()=> '2026-09-23T10:00:00.000Z'});
  assert.equal(first.current(),STORAGE_OWNER_UNBOUND);
  await first.hydrate({legacyOwner:()=> 'account-A'});
  assert.equal(first.current(),'account-A');assert.equal(first.assertSessionOwner(session('account-A')),true);
  assert.equal(first.assertAuthenticatedOwner('account-A'),true);
  assert.throws(()=>first.assertSessionOwner(null),error=>error.code==='storage_owner_reauth_required');
  assert.throws(()=>first.assertAuthenticatedOwner('account-B'),error=>error.code==='storage_owner_auth_mismatch');
  storage.removeItem(storageOwnerCacheKey('orders'));
  const restarted=createStorageOwnerBinding({app:'orders',db,storage,now:()=> '2026-09-23T10:05:00.000Z'});
  await restarted.hydrate({legacyOwner:()=> null});
  assert.equal(restarted.current(),'account-A');
  assert.equal(storage.getItem(storageOwnerCacheKey('orders')),'account-A','IDB repairs the synchronous cache, never the other way around');
});

test('a forged or stale owner cache cannot override IndexedDB authority',async()=>{
  const db=fakeDb(),storage=fakeStorage({[storageOwnerCacheKey('kupa')]:'account-B'});
  db.seedBinding('kupa',{version:1,app:'kupa',owner:'account-A',generation:3,source:'handoff:account-switch',createdAt:'x',updatedAt:'y'});
  const owner=createStorageOwnerBinding({app:'kupa',db,storage});await owner.hydrate({legacyOwner:()=> 'account-B'});
  assert.equal(owner.current(),'account-A');assert.equal(storage.getItem(storageOwnerCacheKey('kupa')),'account-A');
  assert.throws(()=>owner.assertSessionOwner(session('account-B')),error=>error.code==='storage_owner_auth_mismatch'&&error.storageOwner==='account-A'&&error.authOwner==='account-B');
  assert.equal(owner.assertSessionOwner(session('account-A')),true);
});

test('a cache without a durable binding is ignored during first bootstrap',async()=>{
  const db=fakeDb(),storage=fakeStorage({[storageOwnerCacheKey('orders')]:'forged-account'});
  const owner=createStorageOwnerBinding({app:'orders',db,storage,now:()=> 't'});await owner.hydrate({legacyOwner:()=> 'real-account'});
  assert.equal(owner.current(),'real-account');assert.equal(db.snapshot().bindings[0][1].source,'legacy-session-bootstrap');
});

test('owner handoff is restartable and activates the target atomically before final completion',async()=>{
  const db=fakeDb(),storage=fakeStorage();let primary=true,id=0;
  const make=()=>createStorageOwnerBinding({app:'orders',db,storage,primary:()=>primary,operationId:()=>`H${++id}`,now:()=>`T${id}`});
  let owner=make();await owner.hydrate({legacyOwner:()=> 'account-A'});
  const started=await owner.beginHandoff('account-B',{intent:'account-switch'});assert.equal(started.phase,'freezing-source');assert.equal(owner.current(),'account-A');assert.equal(owner.writable,false);
  owner=make();await owner.hydrate({legacyOwner:()=> 'account-B'});assert.equal(owner.current(),'account-A');assert.equal(owner.status().handoff.phase,'freezing-source');
  for(const phase of ['freezing-source','source-settled','target-authenticated'])await owner.advanceHandoff(phase,{proof:phase});
  assert.equal(owner.current(),'account-A');assert.equal(owner.status().handoff.phase,'target-recovered');
  await owner.activateHandoff();assert.equal(owner.current(),'account-B');assert.equal(owner.writable,false);assert.equal(owner.status().handoff.phase,'target-active');assert.equal(owner.status().binding.generation,2);
  owner=make();await owner.hydrate({legacyOwner:()=> 'account-A'});assert.equal(owner.current(),'account-B');assert.equal(owner.locked,true);assert.equal(owner.status().handoff.phase,'target-active','restart retains the in-progress target activation');
  await owner.completeHandoff();assert.equal(owner.current(),'account-B');assert.equal(owner.writable,true);
  const restarted=make();await restarted.hydrate({legacyOwner:()=> 'account-A'});assert.equal(restarted.current(),'account-B');assert.equal(restarted.locked,false);
});

test('handoff cannot be started from a secondary tab or completed out of phase',async()=>{
  const db=fakeDb(),storage=fakeStorage();let primary=false;
  const owner=createStorageOwnerBinding({app:'kupa',db,storage,primary:()=>primary,operationId:()=> 'H'});await owner.hydrate({legacyOwner:()=> 'A'});
  await assert.rejects(owner.beginHandoff('B',{intent:'account-switch'}),/primary_required/);
  primary=true;await owner.beginHandoff('B',{intent:'account-switch'});await assert.rejects(owner.completeHandoff(),/phase_invalid/);
});


test('prepared local account adoption is atomic, durable and cannot be used for account A to B',async()=>{
  const db=fakeDb(),storage=fakeStorage();let id=0;
  const make=()=>createStorageOwnerBinding({app:'orders',db,storage,primary:()=>true,operationId:()=>`L${++id}`,now:()=>`T${id}`});
  let owner=make();await owner.hydrate({legacyOwner:()=> null});assert.equal(owner.current(),'local');
  await assert.rejects(owner.adoptPreparedLocalOwner('account-B',{intent:'load-account'}),/storage_owner_local_adoption_not_reserved/);
  await owner.reserveLocalAdoption('account-B',{intent:'load-account'});assert.equal(owner.current(),'local');assert.equal(owner.writable,true);
  assert.equal(owner.assertAuthenticatedOwner('account-B'),true);assert.throws(()=>owner.assertAuthenticatedOwner('account-C'),error=>error.code==='storage_owner_local_adoption_auth_mismatch'&&error.requiredOwner==='account-B');
  owner=make();await owner.hydrate({legacyOwner:()=> null});assert.equal(owner.current(),'local','reservation survives restart without switching owner');assert.equal(owner.assertAuthenticatedOwner('account-B'),true);
  const adopted=await owner.adoptPreparedLocalOwner('account-B',{intent:'load-account',proof:{mainRevision:7,sharedRevision:9}});
  assert.equal(adopted.owner,'account-B');assert.equal(owner.writable,true);assert.equal(owner.locked,false);
  const durable=db.snapshot();assert.equal(durable.bindings[0][1].source,'prepared-local:load-account');assert.equal(durable.bindings[0][1].pendingAdoption,null);assert.equal(durable.handoffs[0][1].phase,'complete');assert.deepEqual(durable.handoffs[0][1].preparationProof,{mainRevision:7,sharedRevision:9});
  owner=make();await owner.hydrate({legacyOwner:()=> null});assert.equal(owner.current(),'account-B');
  assert.equal((await owner.adoptPreparedLocalOwner('account-B',{intent:'load-account'})).owner,'account-B','retry is idempotent after the atomic adoption');
  await assert.rejects(owner.adoptPreparedLocalOwner('account-C',{intent:'load-account'}),/storage_owner_handoff_required/);
});

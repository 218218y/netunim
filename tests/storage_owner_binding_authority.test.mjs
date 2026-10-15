import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createStorageOwnerBinding,STORAGE_OWNER_UNBOUND,storageOwnerCacheKey} from '../shared/storage-owner.js';
import {readStorageOwnerBinding,readStorageOwnerPair} from '../shared/storage-owner-binding.js';
import {fakeDb,fakeStorage} from './storage_owner_ports.mjs';
const row=()=>({version:1,app:'orders',owner:'A',generation:3,source:'handoff:account-switch',createdAt:'old',updatedAt:'now'});
const pending=()=>({version:1,app:'orders',id:'H',sourceOwner:'A',targetOwner:'B',intent:'account-switch',phase:'freezing-source'});
function fixture(){
  const db=fakeDb(),storage=fakeStorage();db.seedBinding('orders',row());
  const owner=createStorageOwnerBinding({app:'orders',db,storage,operationId:()=> 'H',now:()=> 'T'});
  return {db,storage,owner};
}
test('accepted commit authority survives admission closure but never a generation, verification or leadership change',async()=>{
  const f=fixture();let primary=true;
  const owner=createStorageOwnerBinding({app:'orders',db:f.db,storage:f.storage,primary:()=>primary,operationId:()=> 'H'});
  await owner.hydrate();const commit=owner.captureCommitAuthority();
  const pending=owner.beginHandoff('B',{intent:'account-switch'});
  assert.equal(owner.writable,false);assert.equal(commit(),true);await pending;
  assert.equal(owner.writable,false);assert.equal(commit(),true);
  primary=false;assert.equal(commit(),false);primary=true;
  f.db.seedHandoff('orders',null);f.db.readOwnerHandoff=async()=>null;
  f.db.seedBinding('orders',{...row(),generation:5});await owner.refresh();
  assert.equal(owner.current(),'A');assert.equal(commit(),false,'A to B to A cannot revive an old receipt');
  const current=owner.captureCommitAuthority();assert.equal(current(),true);
  f.db.readOwnerBinding=async()=>{throw Error('read abort')};await assert.rejects(owner.refresh());assert.equal(current(),false);
});
for(const patch of [{version:'1'},{app:'kupa'},{owner:['A']},{owner:' A '},{owner:''},{generation:'3'},{generation:0},{generation:-1},{generation:1.5},{generation:Number.MAX_SAFE_INTEGER+1},{source:['handoff']},{pendingAdoption:{id:'R',targetOwner:'B',intent:'upload-local'}}])test(`invalid durable binding ${JSON.stringify(patch)} cannot publish cache or writer authority`,async()=>{
  const f=fixture(),data={...row(),...patch};f.db.seedBinding('orders',data);
  await assert.rejects(f.owner.hydrate());assert.equal(f.owner.current(),STORAGE_OWNER_UNBOUND);assert.equal(f.owner.ready,false);assert.equal(f.owner.writable,false);assert.equal(f.owner.locked,true);assert.equal(f.storage.getItem(storageOwnerCacheKey('orders')),null);assert.deepEqual(await f.db.readOwnerBinding('orders'),data);
});
for(const patch of [{phase:'future'},{phase:['complete']},{phase:'complete',app:'kupa'},{phase:'complete',id:''},{phase:'complete',targetOwner:['B']},{phase:'target-active'},{sourceOwner:'C'},{intent:['account-switch']},{targetOwner:'local'}])test(`invalid handoff ${JSON.stringify(patch)} remains locked even if it claims completion`,async()=>{
  const f=fixture(),data={...pending(),...patch};f.db.seedHandoff('orders',data);
  await assert.rejects(f.owner.hydrate());assert.equal(f.owner.locked,true);assert.equal(f.owner.writable,false);assert.deepEqual(await f.db.readOwnerHandoff('orders'),data);
});
test('a valid historical completed handoff does not claim the current generation or require new transfer proofs',()=>{
  const data={...pending(),phase:'complete',historicalMetadata:{retained:true}};
  const pair=readStorageOwnerPair({...row(),owner:'C'},data,'orders');assert.equal(pair.binding.owner,'C');assert.equal(pair.handoff,null);
  assert.equal(readStorageOwnerBinding({...row(),futureMetadata:{retained:true}},'orders').futureMetadata.retained,true);
});
test('an orphan handoff cannot initialize a new binding from auth or cache',async()=>{
  const f=fixture();f.db.readOwnerBinding=async()=>null;f.db.seedHandoff('orders',pending());let initialized=0;f.db.initializeOwnerBinding=async()=>{initialized++;return row()};
  await assert.rejects(f.owner.hydrate({initialOwner:()=> 'C'}),/binding_missing/);assert.equal(initialized,0);assert.equal(f.owner.writable,false);
});
test('failed refresh revokes the old binding until both durable records verify again',async()=>{
  const f=fixture();await f.owner.hydrate();f.db.seedHandoff('orders',{...pending(),phase:'future'});
  await assert.rejects(f.owner.refresh());assert.equal(f.owner.current(),'A');assert.equal(f.owner.ready,false);assert.equal(f.owner.writable,false);assert.throws(()=>f.owner.assertReady(),/not_ready/);
  f.db.seedHandoff('orders',{...pending(),phase:'complete'});await f.owner.refresh();assert.equal(f.owner.ready,true);assert.equal(f.owner.writable,true);
});
test('cache publication fails before the owner can become ready',async()=>{
  const f=fixture(),set=f.storage.setItem;f.storage.setItem=()=>{throw Error('cache-unavailable')};
  await assert.rejects(f.owner.hydrate(),/cache-unavailable/);assert.equal(f.owner.current(),STORAGE_OWNER_UNBOUND);assert.equal(f.owner.writable,false);
  f.storage.setItem=set;await f.owner.refresh();assert.equal(f.owner.current(),'A');assert.equal(f.owner.writable,true);
});
test('atomic activation followed by cache failure retains the old visible owner and requires verified refresh',async()=>{
  const f=fixture();await f.owner.hydrate();await f.owner.beginHandoff('B',{intent:'account-switch'});
  for(const phase of ['freezing-source','source-settled','target-authenticated'])await f.owner.advanceHandoff(phase);
  const set=f.storage.setItem;f.storage.setItem=()=>{throw Error('cache-unavailable')};
  await assert.rejects(f.owner.activateHandoff(),/cache-unavailable/);assert.equal((await f.db.readOwnerBinding('orders')).owner,'B');assert.equal(f.owner.current(),'A');assert.equal(f.owner.writable,false);
  f.storage.setItem=set;await f.owner.refresh();assert.equal(f.owner.current(),'B');assert.equal(f.owner.locked,true);await f.owner.completeHandoff();assert.equal(f.owner.writable,true);
});
test('pending binding writes close admission and a substituted reply cannot become authority',async()=>{
  const f=fixture();await f.owner.hydrate();let release;const gate=new Promise(resolve=>{release=resolve}),begin=f.db.beginOwnerHandoff;
  f.db.beginOwnerHandoff=async(...args)=>{await gate;return {...await begin(...args),targetOwner:'C'}};
  const writing=f.owner.beginHandoff('B',{intent:'account-switch'});assert.equal(f.owner.writable,false);assert.equal(f.owner.locked,true);
  await assert.rejects(f.owner.refresh(),/busy/);release();await assert.rejects(writing,/transition_changed/);assert.equal(f.owner.current(),'A');assert.equal(f.owner.ready,false);
  await f.owner.refresh();assert.equal(f.owner.status().handoff.targetOwner,'B');assert.equal(f.owner.locked,true);
});
test('leadership loss after an atomic reply cannot publish its owner',async()=>{
  const db=fakeDb(),begin=db.beginOwnerHandoff;let primary=true;const owner=createStorageOwnerBinding({app:'orders',db,storage:fakeStorage(),primary:()=>primary,operationId:()=> 'H'});await owner.hydrate({initialOwner:()=> 'A'});
  db.beginOwnerHandoff=async(...args)=>{const result=await begin(...args);primary=false;return result};
  await assert.rejects(owner.beginHandoff('B',{intent:'account-switch'}),/changed_during_write/);assert.equal(owner.current(),'A');assert.equal(owner.writable,false);
});
test('advance details cannot overwrite immutable account or transaction identity',async()=>{
  const f=fixture();await f.owner.hydrate();await f.owner.beginHandoff('B',{intent:'account-switch'});
  for(const patch of [{id:'other'},{sourceOwner:'C'},{targetOwner:'C'},{phase:'complete'},{intent:'logout-to-local'}])await assert.rejects(f.owner.advanceHandoff('freezing-source',patch),/identity_override/);
  assert.equal((await f.db.readOwnerHandoff('orders')).phase,'freezing-source');
});
test('implementation mutation reproduces the old silent unlock for malformed completed evidence',async()=>{
  let source=fs.readFileSync('shared/storage-owner-binding.js','utf8').replaceAll('\r\n','\n');
  for(const name of ['storage-operation.js','sync-json.js'])source=source.replace(`'./${name}'`,JSON.stringify(new URL('../shared/'+name,import.meta.url).href));
  const expression='const binding=readStorageOwnerBinding(value,app),record=readStorageOwnerRecord(pending,app);';assert.ok(source.includes(expression));
  source=source.replace(expression,"const binding=readStorageOwnerBinding(value,app),record=pending?.phase==='complete'?null:readStorageOwnerRecord(pending,app);");
  const {readStorageOwnerPair:unsafe}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  assert.equal(unsafe(row(),{...pending(),phase:'complete',targetOwner:[]},'orders').handoff,null);
  assert.throws(()=>readStorageOwnerPair(row(),{...pending(),phase:'complete',targetOwner:[]},'orders'));
});

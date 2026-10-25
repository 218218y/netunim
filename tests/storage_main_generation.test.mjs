import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';
import {createStorageJournal} from '../shared/storage-journal.js';
import {createStorageOwnerBinding} from '../shared/storage-owner-binding.js';
import {fakeDb,fakeStorage} from './storage_owner_ports.mjs';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const state={notes:[{id:'N',content:'saved'}]};
function fixture(binding=null){
  let generation=1;
  const db=memoryDb(),emergency=emergencyStore(),journals=[],scheduled=[];
  const runtime=createStorageV2Runtime({app:'orders',owner:()=>binding?binding.current():'A',primary:()=>binding?binding.writable:true,mode:()=> 'primary',validate:()=>{},
    captureCommitAuthority:()=>{if(binding)return binding.captureCommitAuthority();const accepted=generation;return ()=>accepted===generation},
    compactEvery:1,scheduleIdle:task=>scheduled.push(task),
    createJournal:options=>{const journal=createStorageJournal({...options,db,emergency});journals.push(journal);return journal}});
  return {runtime,db,journals,scheduled,emergency,revoke(){generation++},
    initialize:()=>runtime.initializeCloudHead(7,state,{intent:'cloud-authoritative',sourceOwner:'A'}),
    edit:()=>runtime.persist({notes:[{id:'N',content:'changed'}]},{operations:[{type:'put',collection:'notes',id:'N',mode:'replace'}]})};
}

test('Main revokes same-account readiness/admission and reclaims the same durable epoch with fresh authority',async()=>{
  const f=fixture();await f.initialize();const before=await f.db.load(),epoch=f.journals[0].epoch;
  f.revoke();assert.equal(f.runtime.primaryReady,false);assert.equal(await f.runtime.cloudState(),null);assert.equal(await f.runtime.flush(),false);
  await assert.rejects(f.runtime.materializeFlight(),/not_ready/);
  const write=f.edit();if(write.handled){await write.committed.catch(()=>{});await f.runtime.commitPromise.catch(()=>{})}
  assert.equal(write.handled,false);assert.equal(f.emergency.length,0);assert.deepEqual(await f.db.load(),before);
  const recovered=await f.runtime.recover();assert.equal(recovered.epoch,epoch);assert.deepEqual(recovered.state,state);assert.equal(f.journals.length,2);
  const accepted=f.edit();assert.equal(accepted.handled,true);await accepted.committed;assert.equal(await f.runtime.flush(),true);
});

for(const operation of ['recover','recoverReadOnly','flush'])test(`Main ${operation} cannot complete under a revoked owner generation`,async()=>{
  const f=fixture();await f.initialize();const journal=f.journals[0],method=operation==='flush'?'settled':operation==='recover'?'open':'recover',original=journal[method],entered=gate(),release=gate();
  journal[method]=async(...args)=>{const result=await original(...args);entered.resolve();await release.promise;return result};
  const running=f.runtime[operation]();await entered.promise;const before={...f.runtime.diagnostics};f.revoke();release.resolve();
  assert.equal(await running,operation==='flush'?false:null);assert.equal(f.runtime.primaryReady,false);
  assert.deepEqual(f.runtime.diagnostics,before);
  const recovered=await f.runtime.recover();assert.deepEqual(recovered.state,state);assert.equal(f.journals.length,2);assert.equal(f.runtime.primaryReady,true);
});

test('Main initialization cannot publish success if its commit completed across a generation revocation',async()=>{
  const f=fixture(),initialize=f.db.initializeCloudHead,entered=gate(),release=gate();
  f.db.initializeCloudHead=async(...args)=>{await initialize(...args);entered.resolve();await release.promise};
  const initializing=f.initialize(),rejected=assert.rejects(initializing,/owner_changed/);await entered.promise;const before=await f.db.load();
  f.revoke();release.resolve();await rejected;assert.equal(f.runtime.primaryReady,false);
  const recovered=await f.runtime.recover();assert.equal(recovered.epoch,before.metadata.epoch);assert.deepEqual(recovered.state,state);
});

test('Main recovery closes admission while reopening an active journal',async()=>{
  const f=fixture();await f.initialize();const journal=f.journals[0],open=journal.open,entered=gate(),release=gate();
  journal.open=async()=>{entered.resolve();await release.promise;return open()};
  const recovering=f.runtime.recover();await entered.promise;
  assert.equal(f.runtime.primaryReady,false);assert.equal(f.edit().handled,false);
  release.resolve();assert.ok(await recovering);assert.equal(f.runtime.primaryReady,true);
});

test('Main generation fencing follows a refreshed production owner binding',async()=>{
  const db=fakeDb(),row={version:1,app:'orders',owner:'A',generation:1,source:'bootstrap',createdAt:'T',updatedAt:'T'};
  db.seedBinding('orders',row);const binding=createStorageOwnerBinding({app:'orders',db,storage:fakeStorage()});await binding.hydrate();
  const f=fixture(binding);await f.initialize();const epoch=f.journals[0].epoch;
  db.seedBinding('orders',{...row,generation:3});await binding.refresh();
  assert.equal(binding.writable,true);assert.equal(f.runtime.primaryReady,false);
  const recovered=await f.runtime.recover();assert.equal(recovered.epoch,epoch);assert.equal(f.journals.length,2);
  const write=f.edit();await write.committed;assert.equal(await f.runtime.flush(),true);
});

test('scheduled Main maintenance from an old generation cannot run on the reclaimed journal',async()=>{
  const f=fixture();await f.initialize();const write=f.edit();await write.committed;
  assert.equal(f.scheduled.length,1);let compactions=0;f.journals[0].compact=async()=>{compactions++;return 1};
  f.revoke();await f.runtime.recover();await f.scheduled[0]();assert.equal(compactions,0);assert.equal(f.runtime.primaryReady,true);
});

test('Main cloud-state publication rejects a result read under a previous generation of the same epoch',async()=>{
  const f=fixture();await f.initialize();const journal=f.journals[0],cloudState=journal.cloudState,entered=gate(),release=gate(),epoch=journal.epoch;
  journal.cloudState=async(...args)=>{const result=await cloudState(...args);entered.resolve();await release.promise;return result};
  const reading=f.runtime.cloudState(),rejected=assert.rejects(reading,/owner_changed/);await entered.promise;
  f.revoke();await f.runtime.recover();assert.equal(f.journals[1].epoch,epoch);release.resolve();await rejected;
  assert.equal(f.runtime.primaryReady,true);assert.equal((await f.runtime.cloudState()).base.revision,7);
});

for(const local of [false,true])test(`failed Main reinitialization (${local?'local':'cloud'}) leaves the durable head recoverable and closes readiness`,async()=>{
  const db=memoryDb(),runtime=createStorageV2Runtime({app:'orders',owner:()=>local?'local':'A',primary:()=>true,mode:()=> 'primary',validate:()=>{},
    createJournal:options=>createStorageJournal({...options,db,emergency:emergencyStore()})});
  const initialize=()=>local?runtime.initializeLocal(state):runtime.initializeCloudHead(7,state,{intent:'cloud-authoritative',sourceOwner:'A'});
  await initialize();const before=await db.load();
  await assert.rejects(local?runtime.initializeLocal({notes:[]}):initialize(),/parity_mismatch|initialization_exists/);
  assert.equal(runtime.primaryReady,false);assert.equal(await runtime.flush(),false);assert.deepEqual(await db.load(),before);
  const recovered=await runtime.recover();assert.equal(recovered.epoch,before.metadata.epoch);assert.deepEqual(recovered.state,state);
});

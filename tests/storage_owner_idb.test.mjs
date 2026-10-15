import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createStorageOwnerTransactions} from '../shared/storage-owner-idb.js';
import {ownerDatabase,binding,handoff} from './owner_idb_fixture.mjs';
const version={expectedGeneration:1,at:'T'};

test('read receipts wait for transaction completion and reject a later abort',async()=>{
  const f=ownerDatabase({binding:binding(),held:true}),api=createStorageOwnerTransactions(f);let settled=false;
  const reading=api.readOwnerState('orders').then(value=>{settled=true;return value});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(settled,false);f.release();assert.equal((await reading).binding.owner,'A');
  const aborted=ownerDatabase({binding:binding(),abort:true});await assert.rejects(createStorageOwnerTransactions(aborted).readOwnerState('orders'),/transaction-aborted/);
});
for(const generation of [undefined,'1',true,[],0,-1,1.5,2])test(`invalid/stale generation ${JSON.stringify(generation)} cannot begin a handoff`,async()=>{
  const f=ownerDatabase({binding:binding()}),api=createStorageOwnerTransactions(f);
  await assert.rejects(api.beginOwnerHandoff('orders',handoff(),{expectedGeneration:generation}),/generation_required|generation_changed|non_json_value/);assert.equal(f.writes.length,0);
});
test('A to B to A cannot reuse an earlier binding generation',async()=>{
  const f=ownerDatabase({binding:{...binding(),generation:3}}),api=createStorageOwnerTransactions(f);
  await assert.rejects(api.beginOwnerHandoff('orders',handoff(),version),/generation_changed/);assert.equal(f.writes.length,0);
});
test('valid handoff activation and completion preserve atomic ownership and generation',async()=>{
  const f=ownerDatabase({binding:binding()}),api=createStorageOwnerTransactions(f);await api.beginOwnerHandoff('orders',handoff(),version);
  for(const [from,to] of [['freezing-source','source-settled'],['source-settled','target-authenticated'],['target-authenticated','target-recovered']])await api.advanceOwnerHandoff('orders','H',from,to,{},version);
  const active=await api.activateOwnerHandoff('orders','H','B',version);assert.equal(active.binding.owner,'B');assert.equal(active.binding.generation,2);assert.equal(active.handoff.phase,'target-active');
  await assert.rejects(api.completeOwnerHandoff('orders','H','B',version),/generation_changed/);
  const done=await api.completeOwnerHandoff('orders','H','B',{expectedGeneration:2});assert.equal(done.handoff.phase,'complete');assert.equal(done.binding.owner,'B');
});
test('an aborted activation returns no receipt and commits neither store',async()=>{
  const f=ownerDatabase({binding:binding(),handoff:{...handoff(),phase:'target-recovered'},abort:true}),before=f.snapshot();
  await assert.rejects(createStorageOwnerTransactions(f).activateOwnerHandoff('orders','H','B',version),/transaction-aborted/);assert.deepEqual(f.snapshot(),before);
});
for(const input of [{...binding(),generation:'1'},{...binding(),owner:['A']},{...binding(),generation:Number.MAX_SAFE_INTEGER+1}])test('invalid checksum-valid binding is retained without attempted writes',async()=>{
  const f=ownerDatabase({binding:input}),before=f.snapshot();await assert.rejects(createStorageOwnerTransactions(f).beginOwnerHandoff('orders',handoff(),version));assert.deepEqual(f.snapshot(),before);assert.equal(f.writes.length,0);
});
test('generation overflow aborts before either owner store is written',async()=>{
  const f=ownerDatabase({binding:{...binding(),generation:Number.MAX_SAFE_INTEGER},handoff:{...handoff(),phase:'target-recovered'}});
  await assert.rejects(createStorageOwnerTransactions(f).activateOwnerHandoff('orders','H','B',{expectedGeneration:Number.MAX_SAFE_INTEGER}));assert.equal(f.writes.length,0);
});
test('phase skips, identity patches and changed begin retries are rejected',async()=>{
  const f=ownerDatabase({binding:binding(),handoff:handoff()}),api=createStorageOwnerTransactions(f);
  await assert.rejects(api.advanceOwnerHandoff('orders','H','freezing-source','target-recovered',{},version),/phase_invalid/);
  await assert.rejects(api.advanceOwnerHandoff('orders','H','freezing-source','source-settled',{targetOwner:'C'},version),/identity_override/);
  await assert.rejects(api.beginOwnerHandoff('orders',{...handoff(),targetOwner:'C'},version),/pending/);assert.equal(f.writes.length,0);
});
test('caller patches are detached before waiting for database open',async()=>{
  const f=ownerDatabase({binding:binding(),handoff:handoff()});let release;const gate=new Promise(resolve=>{release=resolve});
  const api=createStorageOwnerTransactions({open:async()=>{await gate;return f.database}}),patch={sourceProof:{note:'accepted'}};
  const writing=api.advanceOwnerHandoff('orders','H','freezing-source','source-settled',patch,version);patch.sourceProof.note='changed';patch.targetOwner='C';release();
  const result=await writing;assert.equal(result.targetOwner,'B');assert.equal(result.sourceProof.note,'accepted');
});
test('implementation mutation proves a stale A to B to A writer was admitted without the generation comparison',async()=>{
  let source=fs.readFileSync('shared/storage-owner-idb.js','utf8').replaceAll('\r\n','\n');
  for(const name of ['storage-json-codec.js','storage-operation.js','sync-json.js','storage-owner-binding.js'])source=source.replace(`'./${name}'`,JSON.stringify(new URL('../shared/'+name,import.meta.url).href));
  const check="if(binding.generation!==expected)throw new Error('storage_owner_generation_changed');";assert.ok(source.includes(check));source=source.replace(check,'');
  const {createStorageOwnerTransactions:unsafe}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const f=ownerDatabase({binding:{...binding(),generation:3}});assert.equal((await unsafe(f).beginOwnerHandoff('orders',handoff(),version)).phase,'freezing-source');assert.equal(f.writes.length,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageJournal} from '../shared/storage-journal.js';
import {sealStorageRecord} from '../shared/storage-journal-model.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';
import {storageRecoveryFailure} from '../shared/storage-v2-runtime.js';

async function fixture(){
  const owner='account:kupa',source=memoryDb();let inject=null,claims=0;
  const db={...source,async load(...args){const stored=await source.load(...args);return inject?inject(stored):stored},async claim(...args){claims++;return source.claim(...args)}};
  const make=()=>createStorageJournal({owner,schema:{collections:['notes'],fields:[]},validate:state=>assert.ok(Array.isArray(state.notes)),db,emergency:emergencyStore()});
  const journal=make();await journal.initializeCloudHead(7,{notes:[]});
  await journal.append([{type:'put',collection:'notes',mode:'insert',index:0,id:'N',record:{id:'N',content:'retained'}}],{generation:1}).committed;
  const flight=await journal.materializeFlight({operationId:'immutable-flight',baseRevision:7});await journal.setCloudControl({retry:{attempts:1}});
  return {owner,source,db,journal,flight,make,claims:()=>claims,patch:(slot,patch)=>{inject=stored=>({...stored,[slot]:stored[slot]&&sealStorageRecord({...stored[slot].data,...patch})})}};
}

for(const [slot,patch,code] of [
  ['bases',{version:1},'storage_invalid_cloud_base'],
  ['flights',{operationId:7},'storage_invalid_cloud_flight'],
  ['flights',{generation:'1'},'storage_invalid_cloud_flight'],
  ['flights',{audit:[]},'storage_invalid_cloud_flight'],
  ['controls',{retry:[]},'storage_invalid_cloud_control'],
  ['controls',{retry:{attempts:'1'}},'storage_invalid_cloud_control'],
  ['controls',{retry:{nextAttemptAt:'not-a-deadline'}},'storage_invalid_cloud_control'],
  ['controls',{conflict:true},'storage_invalid_cloud_control'],
])test(`cloud head rejects malformed ${slot} ${JSON.stringify(patch)} without rewriting`,async()=>{
  const f=await fixture();f.patch(slot,patch);const before=await f.db.load(f.owner);
  await assert.rejects(f.journal.cloudState(),new RegExp('^Error: '+code+'$'));
  assert.deepEqual(await f.db.load(f.owner),before);
});

for(const [label,patch] of [['owner',{owner:'other:kupa'}],['epoch',{epoch:'other-epoch'}],['range',{endSeq:2}],['base revision',{baseRevision:6}]]){
  test(`retained flight materialization refuses inconsistent ${label}`,async()=>{
    const f=await fixture();f.patch('flights',patch);const before=await f.db.load(f.owner);
    await assert.rejects(f.journal.materializeFlight({operationId:'replacement',baseRevision:7}),/storage_cloud_flight_mismatch/);
    assert.deepEqual(await f.db.load(f.owner),before);
  });
}

test('a foreign retained flight cannot be durably ACKed or deleted by the journal API',async()=>{
  const f=await fixture();f.patch('flights',{owner:'other:kupa'});const before=await f.db.load(f.owner);
  await assert.rejects(f.journal.acknowledge('immutable-flight',8,f.flight.snapshot),/storage_cloud_flight_mismatch/);
  assert.deepEqual(await f.db.load(f.owner),before);
});

test('fresh recovery classifies invalid cloud records before claiming a writer',async()=>{
  const f=await fixture();f.patch('controls',{retry:{attempts:-1}});const before=await f.db.load(f.owner);
  await assert.rejects(f.make().open(),error=>error.message==='storage_invalid_cloud_control'&&storageRecoveryFailure(error)==='fatal');
  assert.equal(f.claims(),0);assert.deepEqual(await f.db.load(f.owner),before);
});

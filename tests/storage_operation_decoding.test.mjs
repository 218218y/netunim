import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStoredOperation,replayStorageJournal,sealStorageRecord} from '../shared/storage-journal-model.js';
import {createStorageJournal} from '../shared/storage-journal.js';
import {createStorageV2Runtime,storageRecoveryFailure} from '../shared/storage-v2-runtime.js';
import {readStorageOperation,validateStoredOperation as checkedValidation} from '../shared/storage-operation.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const schema={collections:['notes'],fields:['setting']};
const operation={version:2,owner:'account:kupa',epoch:'epoch',seq:1,generation:1,operationId:'edit-N',at:'stamp',changes:[{type:'put',collection:'notes',mode:'insert',index:0,id:'N',record:{id:'N',content:'retained'}}]};
const checkpoint=sealStorageRecord({version:2,owner:operation.owner,epoch:operation.epoch,seq:0,state:{notes:[],setting:1}});

test('a null operation is a classified persisted-data failure, not a retryable TypeError',()=>{
  assert.throws(()=>validateStoredOperation(null,schema),error=>error.message==='storage_invalid_operation'&&storageRecoveryFailure(error)==='fatal');
});

for(const [label,patch] of [
  ['null change',{changes:[null]}],
  ['array metadata',{appMetadata:[]}],['scalar metadata',{appMetadata:true}],
  ['array surface',{surface:[]}],['numeric surface',{surface:7}],
  ['object mutation type',{mutationType:{}}],['numeric mutation type',{mutationType:7}],
])test(`replay rejects checksum-valid ${label} before applying any changes`,()=>{
  const sealed=sealStorageRecord({...operation,...patch}),before=structuredClone(sealed);
  assert.throws(()=>replayStorageJournal(checkpoint,[sealed],schema),error=>error.message==='storage_invalid_operation'&&storageRecoveryFailure(error)==='fatal');
  assert.deepEqual(sealed,before);
  assert.deepEqual(checkpoint.data.state.notes,[]);
});

test('invalid persisted delete intents are fatal while transaction/ownership failures remain retryable',()=>{
  assert.throws(()=>validateStoredOperation({...operation,deleteIntents:{notes:['N','N']}},schema),error=>error.message==='storage_delete_intents_invalid'&&storageRecoveryFailure(error)==='fatal');
  for(const message of ['storage_fenced','storage_secondary_tab','storage_not_ready','AbortError','QuotaExceededError'])assert.equal(storageRecoveryFailure(new Error(message)),'retryable');
});

async function seeded(){
  const source=memoryDb(),emergency=emergencyStore();let injected=null,claims=0;
  const db={...source,async load(owner){const stored=await source.load(owner);return injected?injected(stored):stored},async claim(...args){claims++;return source.claim(...args)}};
  const validate=state=>assert.ok(Array.isArray(state.notes));
  const make=()=>createStorageJournal({owner:operation.owner,schema,validate,db,emergency});
  const journal=make();await journal.initializeCloudHead(7,{notes:[],setting:1},{appMetadata:{storageRole:'primary',mainProjectionVersion:2}});
  await journal.append(operation.changes,{generation:1}).committed;
  await journal.materializeFlight({operationId:'immutable-flight',baseRevision:7});
  await journal.setCloudControl({retry:{kind:'network',attempt:1}});
  return {source,db,emergency,journal,make,validate,inject:work=>{injected=work},claims:()=>claims};
}

for(const [label,patch,code] of [
  ['null change',{changes:[null]},'storage_invalid_operation'],
  ['foreign owner',{owner:'other-account:kupa'},'storage_foreign_operation'],
  ['invalid delete intents',{deleteIntents:{notes:['N','N']}},'storage_delete_intents_invalid'],
])test(`cloud pending-state reads reject ${label} without touching retained work`,async()=>{
  const env=await seeded(),original=await env.source.load(operation.owner);
  env.inject(stored=>({...stored,journal:stored.journal.map(row=>sealStorageRecord({...row.data,...patch}))}));
  const before=await env.db.load(operation.owner);
  await assert.rejects(env.journal.cloudState(),new RegExp('^Error: '+code+'$'));
  assert.deepEqual(await env.db.load(operation.owner),before);
  assert.deepEqual(await env.source.load(operation.owner),original);
});

test('fresh Main recovery refuses malformed operations before claiming a writer and preserves pending IDs',async()=>{
  const env=await seeded(),original=await env.source.load(operation.owner);
  env.inject(stored=>({...stored,journal:stored.journal.map(row=>sealStorageRecord({...row.data,changes:[null]}))}));
  const before=await env.db.load(operation.owner);
  const runtime=createStorageV2Runtime({app:'kupa',owner:()=> 'account',primary:()=>true,mode:()=> 'primary',validate:env.validate,createJournal:options=>createStorageJournal({...options,db:env.db,emergency:env.emergency})});
  assert.equal(await runtime.recover(),null);
  assert.equal(runtime.diagnostics.lastError,'storage_invalid_operation');
  assert.equal(runtime.diagnostics.recoveryFailure,'fatal');assert.equal(runtime.primaryReady,false);
  assert.equal(env.claims(),0);assert.deepEqual(await env.db.load(operation.owner),before);
  env.inject(null);const restarted=env.make(),recovered=await restarted.open(),cloud=await restarted.cloudState();
  assert.deepEqual(recovered.state.notes,[{id:'N',content:'retained'}]);
  assert.equal(cloud.pending,true);assert.equal(cloud.flight.operationId,'immutable-flight');
  assert.equal(cloud.base.ackSeq,0);assert.equal(cloud.base.revision,7);assert.equal(cloud.control.retry.kind,'network');
  assert.deepEqual((await env.source.load(operation.owner)).journal,original.journal);
});

test('historical absent/null annotations replay with identical bytes, ordering and note identity',()=>{
  for(const value of [undefined,null]){
    const entry=structuredClone(operation);
    if(value===null)Object.assign(entry,{appMetadata:null,deleteIntents:null,surface:null,mutationType:null});
    const sealed=sealStorageRecord(entry),before=structuredClone(sealed),replay=replayStorageJournal(checkpoint,[sealed],schema);
    assert.deepEqual(replay.state.notes,[{id:'N',content:'retained'}]);assert.equal(replay.seq,1);
    assert.deepEqual(sealed,before);
  }
});

test('the checked decoder and compatibility export share one policy and return detached stored values',()=>{
  assert.equal(validateStoredOperation,checkedValidation);
  const sealed=sealStorageRecord(operation),decoded=readStorageOperation(sealed,schema);
  assert.deepEqual(decoded,operation);assert.equal(JSON.stringify(decoded),JSON.stringify(operation));
  decoded.changes[0].record.content='detached';assert.equal(sealed.data.changes[0].record.content,'retained');
  sealed.data.seq=2;assert.throws(()=>readStorageOperation(sealed,schema),/storage_checksum_mismatch/);
});

test('historical replacement indices remain non-authoritative and are not rewritten',()=>{
  const cp=sealStorageRecord({...checkpoint.data,state:{notes:[{id:'N',content:'before'}],setting:1}});
  for(const index of ['ignored',null,{},[]]){
    const entry={...operation,changes:[{...operation.changes[0],mode:'replace',index}]};
    const sealed=sealStorageRecord(entry),decoded=readStorageOperation(sealed,schema);
    assert.deepEqual(decoded.changes[0].index,index);
    assert.deepEqual(replayStorageJournal(cp,[sealed],schema).state.notes,[{id:'N',content:'retained'}]);
  }
});

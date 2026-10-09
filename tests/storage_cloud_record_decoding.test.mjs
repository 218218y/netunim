import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageJournal} from '../shared/storage-journal.js';
import {sealStorageRecord} from '../shared/storage-journal-model.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';
import {storageRecoveryFailure} from '../shared/storage-v2-runtime.js';
import {readStorageCloudBase,readStorageCloudFlight,readStorageCloudControl,readStorageCloudHead,StorageCloudRecordError} from '../shared/storage-cloud-records.js';
import {readFileSync} from 'node:fs';

const scope={owner:'account:kupa',epoch:'epoch',seq:1};
const rawBase={version:2,owner:scope.owner,epoch:scope.epoch,revision:7,ackSeq:0,state:{notes:[]},projection:'cloud'};
const rawFlight={version:2,owner:scope.owner,epoch:scope.epoch,operationId:'immutable',baseRevision:7,startSeq:1,endSeq:1,snapshot:{notes:[{id:'N',content:'retained'}]}};
const rawControl={version:2,owner:scope.owner,epoch:scope.epoch,retry:{attempts:1,nextAttemptAt:null}};
for(const [kind,read,raw,patches] of [
  ['base',readStorageCloudBase,rawBase,[{version:'2'},{owner:7},{epoch:''},{revision:'7'},{revision:-1},{ackSeq:1.5},{state:[]},{projection:'local'}]],
  ['flight',readStorageCloudFlight,rawFlight,[{version:1},{operationId:''},{operationId:' '},{baseRevision:'7'},{startSeq:0},{endSeq:0},{endSeq:1.5},{snapshot:null},{deleteIntents:[]},{deleteIntents:{notes:[7]}},{surface:7},{mutationType:[]},{audit:[]}]],
  ['control',readStorageCloudControl,rawControl,[{version:1},{owner:''},{epoch:7},{retry:true},{retry:{attempts:-1}},{retry:{attempts:1.5}},{retry:{nextAttemptAt:7}},{retry:{nextAttemptAt:'invalid'}},{retry:{lastErrorCode:7}},{retry:{lastAttemptAt:[]}},{updatedAt:7},{conflict:[]}]],
])for(const patch of patches)test(`kind decoder rejects checksum-valid ${kind} ${JSON.stringify(patch)}`,()=>{
  const record=sealStorageRecord({...raw,...patch}),before=JSON.stringify(record);
  assert.throws(()=>read(record),error=>error instanceof StorageCloudRecordError&&error.message==='storage_invalid_cloud_'+kind&&storageRecoveryFailure(error)==='fatal');
  assert.equal(JSON.stringify(record),before);
});

test('historical absent/null annotations and opaque conflict details retain exact sealed bytes',()=>{
  for(const annotations of [{},{generation:null,audit:null,deleteIntents:null,surface:null,mutationType:null},
    {generation:1,audit:{connector:'older'},deleteIntents:{notes:['N','N']},surface:'notes',mutationType:'edit'}]){
    const raw={...rawFlight,...annotations},record=sealStorageRecord(raw);
    assert.deepEqual(readStorageCloudFlight(record),raw);assert.equal(JSON.stringify(sealStorageRecord(readStorageCloudFlight(record))),JSON.stringify(record));
  }
  for(const projection of [undefined,null]){const raw={...rawBase};if(projection===undefined)delete raw.projection;else raw.projection=projection;assert.deepEqual(readStorageCloudBase(sealStorageRecord(raw)),raw)}
  for(const annotations of [{},{retry:null,conflict:null,updatedAt:null},{retry:{kind:'network',attempt:1},conflict:{remote:{id:'R'}},updatedAt:'historical diagnostic stamp'}]){
    const raw={version:2,owner:scope.owner,epoch:scope.epoch,...annotations};assert.deepEqual(readStorageCloudControl(sealStorageRecord(raw)),raw);
  }
});

test('unsupported incomplete historical flight is retained, never silently rebuilt',()=>{
  const raw={...rawFlight};delete raw.startSeq;const record=sealStorageRecord(raw);
  assert.throws(()=>readStorageCloudFlight(record),/storage_invalid_cloud_flight/);assert.deepEqual(record,sealStorageRecord(raw));
});

test('decoded results are detached and all pre-refactor golden heads retain their fields',()=>{
  const golden=JSON.parse(readFileSync(new URL('./fixtures/storage-v2-writer-records.json',import.meta.url),'utf8'));
  for(const stored of Object.values(golden.snapshots)){
    const cp=stored.checkpoints.data,head=readStorageCloudHead({base:stored.bases,flight:stored.flights,control:stored.controls},{owner:cp.owner,epoch:cp.epoch,seq:stored.metadata.seq});
    for(const [key,slot] of [['base','bases'],['flight','flights'],['control','controls']])assert.deepEqual(head[key],stored[slot]?.data??null);
  }
  const record=sealStorageRecord(rawFlight),decoded=readStorageCloudFlight(record);decoded.snapshot.notes=[];assert.deepEqual(record.data,rawFlight);
});

for(const [label,records,code] of [
  ['missing base',{flight:sealStorageRecord(rawFlight)},'storage_cloud_flight_mismatch'],
  ['base owner',{base:sealStorageRecord({...rawBase,owner:'foreign'})},'storage_cloud_base_mismatch'],
  ['base ACK beyond commit',{base:sealStorageRecord({...rawBase,ackSeq:2})},'storage_cloud_base_mismatch'],
  ['flight start gap',{base:sealStorageRecord(rawBase),flight:sealStorageRecord({...rawFlight,startSeq:2,endSeq:2})},'storage_cloud_flight_mismatch'],
  ['control scope',{control:sealStorageRecord({...rawControl,epoch:'foreign'})},'storage_control_scope'],
])test(`one scoped decision rejects ${label} with corruption provenance`,()=>{
  assert.throws(()=>readStorageCloudHead(records,scope),error=>error instanceof StorageCloudRecordError&&error.message===code&&storageRecoveryFailure(error)==='fatal');
  assert.equal(storageRecoveryFailure(new Error(code)),'retryable','an optimistic write precondition is not evidence of persisted corruption');
});

test('invalid metadata and false slot values cannot become an empty cloud head',()=>{
  assert.throws(()=>readStorageCloudHead({},{...scope,seq:'1'}),/storage_committed_metadata_mismatch/);
  for(const key of ['base','flight','control'])assert.throws(()=>readStorageCloudHead({[key]:false},scope),/storage_checksum_mismatch/);
  assert.deepEqual(readStorageCloudHead({},scope),{seq:1,base:null,flight:null,control:null});
});

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

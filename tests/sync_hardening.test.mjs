import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {assertEntityCollection} from '../shared/data-invariants.js';
import {compareOutboxFreshness,createOutboxRecord} from '../shared/cloud-sync.js';
import {createRestoreGroup,createRestoreGroupStore,executeRestoreGroup,resumeRestoreGroup} from '../shared/restore-groups.js';
import {assertOrderEntityInvariants} from '../netunim-orders/site/assets/js/state/validation.js';
import {assertKupaEntityInvariants} from '../netunim-kupa/site/assets/js/state/validation.js';
import {normalizeSharedChecks} from '../netunim-kupa/site/assets/js/domains/checks/model.js';
import {createUiBulk} from '../netunim-kupa/site/assets/js/ui/bulk.js';
import {createDomainsRecordsCommands} from '../netunim-kupa/site/assets/js/domains/records/commands.js';
import {createSyncMerge} from '../netunim-kupa/site/assets/js/sync/merge.js';
import {createSyncPending} from '../netunim-kupa/site/assets/js/sync/pending.js';
import {createStoragePending} from '../netunim-kupa/site/assets/js/storage/pending.js';

class StorageMock{
  constructor(){this.items=new Map()}
  getItem(key){return this.items.get(key)??null}
  setItem(key,value){this.items.set(key,String(value))}
  removeItem(key){this.items.delete(key)}
}

test('entity invariants reject missing, blank, noncanonical and duplicate IDs before normalization',()=>{
  for(const rows of [[{name:'missing'}],[{id:''}],[{id:'   '}],[{id:' X '}],[{id:'D'},{id:'D'}]])assert.throws(()=>assertEntityCollection(rows,'rows'));
  assert.doesNotThrow(()=>assertEntityCollection([{id:'A'},{id:'B'}],'rows'));
  assert.throws(()=>assertOrderEntityInvariants({suppliers:[{id:'D'},{id:'D'}]}));
  assert.throws(()=>assertKupaEntityInvariants({credits:[{id:''}]}));
  assert.throws(()=>normalizeSharedChecks([{name:'missing id'}]));
});

async function assertKupaBulkIntent(collection){
  const ui={bulkCollection:collection,bulkSelected:new Set([`${collection}-1`,`${collection}-2`])},model={state:{[collection]:[{id:`${collection}-1`},{id:`${collection}-2`},{id:`${collection}-3`}]}},calls=[];
  const api=createUiBulk({ui,model,render(){},toast(){},confirmDialog:async()=>true,saveState:(message,options)=>calls.push(['main',options]),saveChecksState:(message,options)=>calls.push(['checks',options])});
  await api.deleteBulkSelected(collection);
  assert.deepEqual(model.state[collection].map(row=>row.id),[`${collection}-3`]);assert.equal(calls.length,1);
  const [kind,options]=calls[0];assert.equal(options.mutationType,'bulk-delete');assert.equal(options.surface,`kupa.bulk.${collection}`);
  if(collection==='checks'){assert.equal(kind,'checks');assert.deepEqual(options.deletedIds,[`${collection}-1`,`${collection}-2`])}
  else{assert.equal(kind,'main');assert.deepEqual(options.deleteIntents,{[collection]:[`${collection}-1`,`${collection}-2`]})}
}

test('Kupa bulk checks deletion declares exact IDs',()=>assertKupaBulkIntent('checks'));
test('Kupa bulk credits deletion declares exact IDs',()=>assertKupaBulkIntent('credits'));
test('Kupa bulk cash deletion declares exact IDs',()=>assertKupaBulkIntent('cash'));
test('Kupa bulk rights deletion declares exact IDs',()=>assertKupaBulkIntent('rights'));

test('single Kupa deletion declares intent for main records and Shared Checks',async()=>{
  for(const collection of ['credits','checks']){
    const calls=[],model={state:{[collection]:[{id:'ONE'},{id:'KEEP'}]}},api=createDomainsRecordsCommands({model,closeModal(){},confirmDialog:async()=>true,saveState:(message,options)=>calls.push(options),saveChecksState:(message,options)=>calls.push(options)});
    await api.deleteRecord(collection,'ONE');assert.deepEqual(model.state[collection],[{id:'KEEP'}]);assert.deepEqual(calls[0],collection==='checks'?{deletedIds:['ONE'],mutationType:'delete',surface:'kupa.delete.checks'}:{deleteIntents:{credits:['ONE']},mutationType:'delete',surface:'kupa.delete.credits'});
  }
});

function bulkRetryFixture(){
  Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
  let cached=null;const session={dbRevision:4,localGeneration:7,cloudOutboxCommitPromise:null,cloudConflictPending:false,cloudDocumentName:'main'};
  const pending=createSyncPending({session,prepareKupaCloudState:value=>structuredClone(value),setSaveStatus(){},setCloudHeaderStatus(){},loadCloudPendingSync:()=>cached,persistCloudPendingSync:value=>(cached=structuredClone(value),true),putCloudPending:async value=>{cached=structuredClone(value)},lastSavedCloudState:()=>({credits:[{id:'C'}]}),getCloudPending:async()=>cached,rebaseKupaCloudProgress:(base,local)=>local});
  return {pending,get cached(){return cached}};
}

test('bulk delete intent survives a failed write retry',()=>{
  const fixture=bulkRetryFixture(),snapshot={credits:[]};fixture.pending.stageCloudPendingLocal(snapshot,'bulk',4,{credits:[{id:'C'}]},7,false,undefined,{credits:['C']},{mutationType:'bulk-delete'});
  const operationId=fixture.cached.operationId,retried=fixture.pending.stageCloudPendingLocal(snapshot,'retry',4,{credits:[{id:'C'}]},7,false,{attempts:1},undefined,{});assert.deepEqual(retried.deleteIntents,{credits:['C']});assert.equal(retried.operationId,operationId);
});

test('conflict during bulk deletion is surfaced and never overwritten silently',()=>{
  const merge=createSyncMerge({normalizeState:value=>value,prepareKupaCloudState:value=>value}),base={credits:[{id:'C',amount:1}]},local={credits:[]},remote={credits:[{id:'C',amount:2}]};
  const result=merge.mergeState3Way(base,local,remote,{deleteIntents:{credits:['C']}});assert.deepEqual(result.conflicts,['credits:C']);assert.deepEqual(result.state.credits,[]);
});

test('outbox freshness uses generation then mutationSeq, never wall-clock time',()=>{
  const oldClock=createOutboxRecord({domain:'orders',generation:9,mutationSeq:20,operationId:'same',snapshot:{value:'new'},createdAt:'2030-01-01T00:00:00Z',updatedAt:'1990-01-01T00:00:00Z'});
  const newClock=createOutboxRecord({domain:'orders',generation:9,mutationSeq:19,operationId:'same',snapshot:{value:'old'},createdAt:'1990-01-01T00:00:00Z',updatedAt:'2999-01-01T00:00:00Z'});
  assert.ok(compareOutboxFreshness(oldClock,newClock)>0);
  const invalidTime={...newClock,mutationSeq:21,updatedAt:'not-a-time'};assert.ok(compareOutboxFreshness(invalidTime,oldClock)>0);
  const newerPayload={...oldClock,mutationSeq:21,snapshot:{value:'newer'}};assert.ok(compareOutboxFreshness(newerPayload,oldClock)>0);
});

test('LocalStorage and IndexedDB disagreement is repaired from deterministic mutationSeq ordering',async()=>{
  const storage=new StorageMock();Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
  const local=createOutboxRecord({domain:'kupa',generation:12,mutationSeq:30,operationId:'same',snapshot:{value:'local-old'},updatedAt:'2999-01-01T00:00:00Z'});
  const durable=createOutboxRecord({domain:'kupa',generation:12,mutationSeq:31,operationId:'same',snapshot:{value:'idb-new'},updatedAt:'invalid'}),writes=[];
  const api=createStoragePending({session:{localGeneration:0,dbRevision:1,cloudOutboxCommitPromise:null,cloudDocumentName:'main'},idbGet:async(_store,key)=>key==='cloud-pending-v3'?durable:null,idbPut:async(_store,key,value)=>writes.push([key,structuredClone(value)]),idbDelete:async()=>{}});
  assert.equal(api.persistCloudPendingSync(local),true);const chosen=await api.getCloudPending();
  assert.equal(chosen.snapshot.value,'idb-new');assert.equal(JSON.parse(storage.getItem('kupa.cloud.pending.local.v1')).snapshot.value,'idb-new');assert.equal(writes.at(-1)[1].mutationSeq,31);
});

function memoryRestoreStore(){
  const storage=new StorageMock(),idb=new Map(),store=createRestoreGroupStore({localKey:'restore.test',storage,put:async(key,value)=>idb.set(key,structuredClone(value)),get:async key=>structuredClone(idb.get(key)??null),remove:async key=>idb.delete(key)});return {store,storage,idb};
}

async function sampleRestore(){return createRestoreGroup({appSite:'kupa',restoreGroupId:'11111111-1111-4111-8111-111111111111',cryptoImpl:webcrypto,main:{documentName:'main',baseRevision:10,state:{credits:[{id:'C'}]},deleteIntents:{}},checks:{documentName:'main',baseRevision:20,state:{checks:[{id:'K'}],bankEvents:[]},deleteIds:[]},beforeState:{main:{credits:[{id:'OLD'}]},checks:{checks:[{id:'OLD-K'}]}},localTargetState:{credits:[{id:'C'}],checks:[{id:'K'}]}})}

test('restore group remains durable and resumable across every persisted phase and lost ACK',async()=>{
  const group=await sampleRestore();
  for(const failAt of ['server-stage','cloud_staged','applying','apply','local','complete']){
    const {store:rawStore,idb}=memoryRestoreStore();let applied=0,sideEffects=0,localApplications=0,serverStaged=false,failed=true;
    const fail=point=>{if(failed&&failAt===point){failed=false;throw new Error(`${point} crash`)}};
    const store={
      ...rawStore,
      async advance(current,phase){fail(phase);return rawStore.advance(current,phase)},
      async complete(current){fail('complete');return rawStore.complete(current)},
    };
    const stageRemote=async()=>{fail('server-stage');serverStaged=true};
    const applyRemote=async()=>{assert.equal(serverStaged,true);if(!sideEffects)sideEffects++;applied++;if(failAt==='apply'&&failed){failed=false;throw new Error('lost ACK')}return {main_revision:11,checks_revision:21}};
    const onApplied=async()=>{fail('local');localApplications++};
    await assert.rejects(executeRestoreGroup(group,{store,stageRemote,applyRemote,onApplied}),failAt);assert.ok(await store.loadPending());
    const result=await resumeRestoreGroup({store,stageRemote,applyRemote:async id=>{assert.equal(serverStaged,true);if(sideEffects===0)sideEffects++;applied++;return {restore_group_id:id,main_revision:11,checks_revision:21}},onApplied:async()=>{localApplications++}});
    assert.equal(result.group.phase,'completed');assert.equal(await store.loadPending(),null);assert.equal(idb.get(store.archiveKey(group.restoreGroupId)).phase,'completed');assert.equal(sideEffects,1);assert.ok(applied>=1);assert.ok(localApplications>=1);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedChecksStorageV2} from '../shared/shared-checks-storage-v2.js';
import {createSharedChecksObserver} from '../shared/shared-checks-v2-shadow.js';
import {readStorageRecord} from '../shared/storage-journal-model.js';

const clone=structuredClone;
function emergencyStore({failWrites=false}={}){const rows=new Map();return {get length(){return rows.size},key:index=>[...rows.keys()][index]??null,getItem:key=>rows.get(key)??null,setItem:(key,value)=>{if(failWrites)throw new Error('quota');rows.set(key,value)},removeItem:key=>rows.delete(key)}}
function memoryDb(){
  let checkpoints=null,metadata=null,journal=[],bases=null,flights=null,controls=null;
  const scoped=(epoch,writer)=>{assert.equal(metadata.epoch,epoch);assert.equal(metadata.writer,writer)};
  return {
    async load(){return clone({checkpoints,metadata,journal,bases,flights,controls})},
    async install(_owner,checkpoint,writer,{expectedEpoch=null}={}){assert.equal(metadata?.epoch??null,expectedEpoch);const data=readStorageRecord(checkpoint);checkpoints=clone(checkpoint);metadata={epoch:data.epoch,seq:data.seq,writer};journal=[];bases=null;flights=null;controls=null},
    async claim(_owner,epoch,writer){assert.equal(metadata.epoch,epoch);metadata={...metadata,writer}},
    async append(_owner,epoch,writer,record){scoped(epoch,writer);const data=readStorageRecord(record);assert.equal(data.seq,metadata.seq+1);journal.push(clone(record));metadata={...metadata,seq:data.seq}},
    async compact(_owner,epoch,writer,checkpoint){scoped(epoch,writer);checkpoints=clone(checkpoint);const seq=readStorageRecord(checkpoint).seq,ack=bases?readStorageRecord(bases).ackSeq:seq;journal=journal.filter(row=>row.data.seq>Math.min(seq,ack))},
    async setBase(_owner,epoch,writer,base){scoped(epoch,writer);assert.equal(flights,null);bases=clone(base)},
    async beginFlight(_owner,epoch,writer,flight){scoped(epoch,writer);if(flights)return clone(flights);flights=clone(flight);return clone(flight)},
    async acknowledge(_owner,epoch,writer,id,base,{checkpoint=null,control=null}={}){scoped(epoch,writer);assert.equal(readStorageRecord(flights).operationId,id);bases=clone(base);if(checkpoint)checkpoints=clone(checkpoint);flights=null;controls=control&&clone(control)},
    async rejectFlight(_owner,epoch,writer,id,base,control=null){scoped(epoch,writer);assert.equal(readStorageRecord(flights).operationId,id);bases=clone(base);flights=null;controls=control&&clone(control)},
    async setControl(_owner,epoch,writer,control){scoped(epoch,writer);controls=clone(control)},
    async clearControl(_owner,epoch,writer){scoped(epoch,writer);controls=null},
    async adoptCloudHead(_owner,epoch,writer,checkpoint,base){scoped(epoch,writer);assert.equal(flights,null);assert.equal(readStorageRecord(bases).ackSeq,metadata.seq);checkpoints=clone(checkpoint);bases=clone(base);controls=null},
    async resetState(_owner,epoch,writer,checkpoint){scoped(epoch,writer);const next=readStorageRecord(checkpoint);checkpoints=clone(checkpoint);metadata={epoch:next.epoch,seq:0,writer};journal=[];bases=null;flights=null;controls=null},
  };
}
function fixture({db=memoryDb(),emergency=emergencyStore(),owner=()=> 'account-A'}={}){
  let n=0;const create=(options={})=>createSharedChecksStorageV2({owner,primary:()=>true,db,emergency,operationId:()=>`op-${++n}`,now:()=> '2026-09-23T00:00:00Z',...options});
  return {create,db,emergency};
}
const state=(checks=[],bankEvents=[])=>({checks,bankEvents});
const check=(id,status='open')=>({id,status,amount:100});
const put=(id,mode='replace',index=0)=>({type:'put',collection:'checks',id,mode,index});
const del=id=>({type:'delete',collection:'checks',id});

test('Shared Checks V2 refuses a cursor until legacy pending is drained and the visible state matches the cloud',async()=>{
  const f=fixture(),store=f.create();await assert.rejects(store.open({migrationState:state([check('C')])}),/transfer_intent_required/);await store.open({migrationState:state([check('C')]),migrationIntent:'legacy-upgrade',sourceOwner:'account-A'});
  await assert.rejects(store.captureCloudCursor(7,state([check('C')])),/legacy_pending_unverified/);
  await assert.rejects(store.captureCloudCursor(7,state([check('other')]),{legacyPendingClean:true}),/cursor_state_mismatch/);
  await store.captureCloudCursor(7,{version:1,...state([check('C')])},{legacyPendingClean:true});
  assert.equal((await store.cloudState()).base.revision,7);
  assert.deepEqual(Object.keys((await store.cloudState()).base.state),['checks','bankEvents'],'server envelope metadata is outside the canonical Shared Checks document');
});

test('Shared Checks V2 keeps a deposited flight immutable across a later edit, ACK, restart and compaction',async()=>{
  const f=fixture(),store=f.create(),base=state([check('A'),check('B')]);await store.open({migrationState:base,migrationIntent:'legacy-upgrade',sourceOwner:'account-A'});await store.captureCloudCursor(10,base,{legacyPendingClean:true});
  const deposited=state([check('A','deposited'),check('B')]);const first=store.append([put('A')],deposited,{generation:1,surface:'checks.deposit'});await first.committed;
  const flight=await store.materializeFlight({operationId:'flight-deposit'});assert.equal(flight.endSeq,1);assert.equal(flight.snapshot.checks[0].status,'deposited');
  const later=state([check('A','deposited'),check('B','cleared')]);const second=store.append([put('B')],later,{generation:2,surface:'checks.clear'});await second.committed;
  assert.deepEqual(await store.materializeFlight({operationId:'must-not-replace'}),flight);
  const authoritative=state(deposited.checks,[{seq:42,checkId:'A',kind:'deposit'}]),rebasedLocal=state(later.checks,authoritative.bankEvents);
  await assert.rejects(store.acknowledge(flight.operationId,11,authoritative,{currentState:later,expectedSeq:2}),/bank_events_missing/);
  await store.acknowledge(flight.operationId,11,authoritative,{currentState:rebasedLocal,expectedSeq:2});
  let cloud=await store.cloudState();assert.equal(cloud.base.ackSeq,1);assert.equal(cloud.pending,true);assert.equal(cloud.pendingDeleteIntents.checks,undefined);
  await store.compact();assert.equal(f.db.load!==undefined,true);
  const restarted=f.create();const recovered=await restarted.open();assert.equal(recovered.state.checks[1].status,'cleared');assert.equal(recovered.state.bankEvents[0].seq,42);cloud=await restarted.cloudState();assert.equal(cloud.pending,true);
  const next=await restarted.materializeFlight({operationId:'flight-clear'});assert.equal(next.startSeq,2);assert.equal(next.snapshot.checks[1].status,'cleared');
});

test('Shared Checks V2 retains explicit deletion through compaction and rotates a confirmed conflict flight',async()=>{
  const f=fixture(),store=f.create(),base=state([check('A'),check('B')]);await store.open({migrationState:base,migrationIntent:'legacy-upgrade',sourceOwner:'account-A'});await store.captureCloudCursor(3,base,{legacyPendingClean:true});
  const afterDelete=state([check('B')]);const write=store.append([del('A')],afterDelete,{generation:1,mutationType:'delete',deleteIds:['A']});await write.committed;
  await store.compact();const first=await store.materializeFlight({operationId:'delete-flight'});assert.deepEqual(first.deleteIntents,{checks:['A']});
  await store.rejectAndRebase(first.operationId,4,state([check('A','remote'),check('B')]),{control:{conflict:{kind:'same-check'}}});
  await assert.rejects(store.materializeFlight({operationId:'blocked'}),/conflict_blocked/);
  await store.clearCloudControl();const second=await store.materializeFlight({operationId:'delete-flight-after-rebase',snapshot:afterDelete});
  assert.notEqual(second.operationId,first.operationId);assert.deepEqual(second.deleteIntents,{checks:['A']});assert.equal(second.baseRevision,4);
});

test('Shared Checks V2 rejects deletes without matching explicit intents or with a still-visible check',async()=>{
  const f=fixture(),store=f.create(),base=state([check('A')]);await store.open({migrationState:base,migrationIntent:'legacy-upgrade',sourceOwner:'account-A'});
  assert.throws(()=>store.append([del('A')],state([])),/delete_intents_mismatch/);
  assert.throws(()=>store.append([del('A')],base,{deleteIds:['A']}),/delete_still_visible/);
  assert.equal(store.seq,0);
});

test('Shared Checks V2 retries the exact immutable flight after a lost ACK and refuses a stale ACK checkpoint',async()=>{
  const f=fixture(),store=f.create(),base=state([check('A')]);await store.open({migrationState:base,migrationIntent:'legacy-upgrade',sourceOwner:'account-A'});await store.captureCloudCursor(7,base,{legacyPendingClean:true});
  const next=state([check('A','deposited')]);await store.append([put('A')],next,{generation:1}).committed;
  const flight=await store.materializeFlight({operationId:'lost-ack'}),restarted=f.create();await restarted.open();
  assert.deepEqual(await restarted.materializeFlight({operationId:'new-id-must-not-be-used'}),flight);
  const later=state([check('A','returned')]);await restarted.append([put('A')],later,{generation:2}).committed;
  await assert.rejects(restarted.acknowledge(flight.operationId,8,next,{currentState:next,expectedSeq:1}),/checkpoint_stale/);
  assert.equal((await restarted.cloudState()).flight.operationId,flight.operationId);
  await restarted.acknowledge(flight.operationId,8,next,{currentState:later,expectedSeq:2});
  assert.equal((await restarted.recover()).state.checks[0].status,'returned');
  assert.equal((await restarted.cloudState()).pending,true);
});

test('Shared Checks V2 allows IDB durability after emergency quota failure and fences an old owner',async()=>{
  let account='A';const f=fixture({owner:()=>account,emergency:emergencyStore({failWrites:true})}),store=f.create(),base=state([check('C')]);await store.open({migrationState:base,migrationIntent:'legacy-upgrade',sourceOwner:'A'});
  const changed=state([check('C','deposited')]),write=store.append([put('C')],changed,{generation:1});assert.equal(write.emergencyDurable,false);await write.committed;
  const restarted=f.create();assert.equal((await restarted.open()).state.checks[0].status,'deposited');
  account='B';assert.throws(()=>store.append([put('C')],changed),/owner_changed/);
  await assert.rejects(restarted.cloudState(),/owner_changed/);
});

test('Shared Checks V2 never promotes a shadow checkpoint or transfers account A data into account B implicitly',async()=>{
  const db=memoryDb(),emergency=emergencyStore(),owner=()=> 'A',seed=state([check('A')]);
  const shadow=createSharedChecksStorageV2({owner,primary:()=>true,role:'shadow',db,emergency});
  await shadow.open({migrationState:seed,migrationIntent:'shadow-observation',sourceOwner:'A'});
  await assert.rejects(shadow.captureCloudCursor(1,seed,{legacyPendingClean:true}),/shadow_cloud_write_forbidden/);
  await assert.rejects(shadow.materializeFlight({operationId:'forbidden'}),/shadow_cloud_write_forbidden/);
  const primary=createSharedChecksStorageV2({owner,primary:()=>true,db,emergency});
  await assert.rejects(primary.open(),/role_mismatch/);
  assert.equal(primary.ready,false);
  assert.throws(()=>primary.append([put('A')],seed),/not_open/);
  await assert.rejects(primary.promoteVerifiedShadow(seed),/promotion_not_verified/);
  const promoted=await primary.promoteVerifiedShadow(seed,{legacyPendingClean:true});
  assert.equal(promoted.appMetadata.storageRole,'shared-checks-primary');
  const restarted=createSharedChecksStorageV2({owner,primary:()=>true,db,emergency});assert.deepEqual((await restarted.open()).state,seed);
  const separate=createSharedChecksStorageV2({owner:()=> 'B',primary:()=>true,db:memoryDb(),emergency});
  await assert.rejects(separate.open({migrationState:seed,migrationIntent:'legacy-upgrade',sourceOwner:'A'}),/transfer_intent_required/);
});

test('Shared Checks shadow replays real typed edits, checkpoints authoritative pulls and reports incomplete descriptors',async()=>{
  const f=fixture();let visible=state([check('A')]);const shadow=createSharedChecksObserver({owner:()=> 'account-A',primary:()=>true,enabled:()=>true,createStorage:f.create,readState:()=>visible});
  assert.equal(shadow.boundary(),true);await shadow.flush();
  visible=state([check('A','deposited')]);shadow.mutation([put('A')],{surface:'checks.deposit'});await shadow.flush();
  assert.equal(shadow.diagnostics.operations,1);assert.equal(shadow.diagnostics.parityChecks,1);
  visible=state([check('A','deposited')],[{seq:7,checkId:'A'}]);shadow.boundary();await shadow.flush();
  visible=state([],[{seq:7,checkId:'A'}]);shadow.mutation([del('A')],{deleteIds:['A']});await shadow.flush();
  assert.equal(shadow.diagnostics.operations,2,JSON.stringify(shadow.diagnostics));
  visible=state([check('B')],[{seq:7,checkId:'A'}]);shadow.mutation([put('A')]);await shadow.flush();
  assert.equal(shadow.diagnostics.mismatches,1,'an incomplete mutation description is diagnosed instead of trusted');
  visible=state([check('B','deposited')],[{seq:7,checkId:'A'}]);shadow.mutation(null);await shadow.flush();
  assert.equal(shadow.diagnostics.missingOperations,1,'a missing typed descriptor must remain visible in diagnostics');
  assert.ok(shadow.diagnostics.boundaries>=2);
});

test('Shared Checks shadow pauses on a live account switch instead of copying one account into another namespace',async()=>{
  let account='A',created=0,visible=state([check('A')]);const f=fixture();
  const observer=createSharedChecksObserver({owner:()=>account,primary:()=>true,enabled:()=>true,readState:()=>visible,createStorage:options=>{created++;return f.create(options)}});
  observer.boundary();await observer.flush();assert.equal(created,1);
  account='B';visible=state([check('B')]);assert.equal(observer.boundary(),false);await observer.flush();
  assert.equal(created,1);assert.equal(observer.diagnostics.ownerTransitions,1);
});

test('Shared Checks shadow observation cannot interrupt the authoritative V1 save',async()=>{
  const observer=createSharedChecksObserver({owner:()=> 'A',primary:()=>true,enabled:()=>true,
    readState:()=>state([{id:'A',unsupported:()=>{}}]),createStorage:()=>assert.fail('a non-cloneable observation cannot reach storage')});
  assert.equal(observer.mutation([put('A')]),false);
  assert.equal(observer.diagnostics.errors,1);
});

test('Shared Checks shadow reports an edit observed before its initial baseline',async()=>{
  const f=fixture(),observer=createSharedChecksObserver({owner:()=> 'A',primary:()=>true,enabled:()=>true,
    readState:()=>state([check('A')]),createStorage:f.create});
  assert.equal(observer.mutation([put('A')]),true);
  await observer.flush();
  assert.equal(observer.diagnostics.unverifiedBaseline,1);
});

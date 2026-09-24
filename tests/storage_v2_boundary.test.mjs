import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageV2Boundary} from '../shared/storage-v2-boundary.js';
import {createStoragePersistence as createKupaStoragePersistence} from '../netunim-kupa/site/assets/js/storage/persistence.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';
import {INITIAL_STATE as KUPA_INITIAL_STATE} from '../netunim-kupa/site/assets/js/state/constants.js';

const clone=structuredClone;

test('Kupa V2 turns isolated expired-credit cleanup into a typed delete and rejects an unrelated untyped edit',async()=>{
  const model={state:clone(KUPA_INITIAL_STATE)},normalization=createStateNormalization({model});
  model.state.creditSync={version:3,profiles:[],cardMappings:{}};
  model.state=normalization.normalizeState(model.state);
  const oldCredit={id:'expired',card:'old',account:'עסקי',active:false,firstChargeDate:'2024-01-01',totalAmount:100,installments:1};
  model.state.credits.push(oldCredit);
  const recovered=clone(model.state),writes=[],session={connectionMode:'supabase',backendReady:true,dbRevision:3,localGeneration:0,saveQueue:Promise.resolve()};
  const storage=createKupaStoragePersistence({model,session,files:{},tab:{primaryTab:true},checksSession:{},
    storageV2Primary:()=>true,storageV2CloudOutboxActive:()=>true,recoverStorageV2State:async()=>({state:clone(recovered)}),
    normalizeState:normalization.normalizeState,prepareKupaCloudState:normalization.prepareKupaCloudState,
    persistImmediateBrowserSnapshot:(_state,_revision,options)=>{writes.push(clone(options));return true},
    persistSupabaseState:async()=>true,setSaveStatus:()=>{},lastSavedCloudState:()=>null});
  assert.equal(await storage.saveState('expired cleanup'),true);
  assert.equal(writes.length,1);
  assert.deepEqual(writes[0].operations,[{type:'delete',collection:'credits',id:'expired'}]);
  assert.equal(!!writes[0].storageBoundary,false);
  writes.length=0;model.state.notes.push({id:'untyped',content:'not in journal',createdAt:'2026-09-23',updatedAt:'2026-09-23'});
  const priorError=console.error;console.error=()=>{};
  try{assert.equal(await storage.saveState('unsafe'),false)}finally{console.error=priorError}
  assert.equal(writes.length,0,'an unrelated edit cannot be hidden by the normalization delete');
});

test('Kupa opening a local file preserves both V2 cloud heads as pending import',async()=>{
  const original={notes:[],checks:[]},imported={notes:[{id:'n',content:'file'}],checks:[{id:'c',amount:10}]};
  const mainCloud={seq:4,base:{revision:8,ackSeq:4},pending:false,flight:null,control:null};
  const sharedCloud={seq:2,base:{revision:11,ackSeq:2},pending:false,flight:null,control:null};
  const calls=[],model={state:clone(original),lastNormalizeRemovedCredits:0},session={connectionMode:'file'};
  let fileState=clone(imported),head=clone(mainCloud);
  const storage=createKupaStoragePersistence({model,session,files:{dataFileHandle:{name:'local.json'}},checksSession:{sharedChecksBankEvents:[{seq:1,checkId:'prior'}]},
    storageV2Primary:()=>true,sharedChecksV2:{primaryReady:true,cloudState:async()=>clone(sharedCloud)},storageV2Boundary:{run:async action=>{calls.push(action);return {phase:'complete'}}},
    refreshStorageV2CloudState:async()=>clone(head),readJsonHandle:async()=>({}),captureLegacyWorkbook:async()=>{},stateFromPayload:()=>({state:clone(fileState),meta:{revision:3}}),
    replaceStorageV2AuthoritativeState:async()=>{throw Error('local file cannot be cloud ACK')},persistImmediateBrowserSnapshot:()=>{throw Error('legacy snapshot')},
    listBackups:async()=>[],setConnectedStatus:()=>{},setSaveStatus:()=>{}});
  await storage.loadState();
  assert.equal(calls.length,1);
  assert.equal(calls[0].kind,'import');
  assert.deepEqual([calls[0].main.expectedSeq,calls[0].main.expectedBaseRevision],[4,8]);
  assert.deepEqual([calls[0].shared.expectedSeq,calls[0].shared.expectedBaseRevision],[2,11]);
  assert.deepEqual(calls[0].shared.state.bankEvents,[{seq:1,checkId:'prior'}]);
  assert.deepEqual(model.state,imported);
  await storage.loadState();
  assert.equal(calls.length,1,'reopening the same file does not duplicate its pending import');
  fileState.notes[0].content='changed while prior import is pending';
  head.pending=true;
  await assert.rejects(storage.loadState(),/storage_local_import_head_not_clean/);
  assert.equal(calls.length,1);
  assert.deepEqual(model.state,imported,'an unresolved import cannot be replaced by the file');
});

test('Kupa opening a file under local-only V2 replaces Main and Shared without creating cloud pending',async()=>{
  const model={state:{notes:[],checks:[{id:'old-check',amount:10}]},lastNormalizeRemovedCredits:0};
  const imported={notes:[{id:'n',content:'file'}],checks:[{id:'new-check',amount:20}]},calls=[];
  const storage=createKupaStoragePersistence({model,session:{connectionMode:'file'},files:{dataFileHandle:{name:'local.json'}},checksSession:{sharedChecksBankEvents:[{seq:3,checkId:'old-check'}]},
    storageV2Primary:()=>true,sharedChecksV2:{localReady:true,recover:async()=>({seq:4})},storageV2Boundary:{run:async action=>{calls.push(action);return {phase:'complete'}}},
    recoverStorageV2State:async()=>({seq:7}),refreshStorageV2CloudState:async()=>null,
    readJsonHandle:async()=>({}),captureLegacyWorkbook:async()=>{},stateFromPayload:()=>({state:clone(imported),meta:{revision:1}}),
    replaceStorageV2AuthoritativeState:async()=>{throw Error('Main-only checkpoint replacement is unsafe')},
    persistImmediateBrowserSnapshot:()=>{throw Error('V1 snapshot is forbidden')},
    listBackups:async()=>[],setConnectedStatus:()=>{},setSaveStatus:()=>{}});
  await storage.loadState();
  assert.equal(calls.length,1);
  assert.deepEqual([calls[0].main.kind,calls[0].main.expectedSeq],['replace-local-authoritative',7]);
  assert.deepEqual([calls[0].shared.kind,calls[0].shared.expectedSeq],['replace-local-authoritative',4]);
  assert.deepEqual(calls[0].shared.state.bankEvents,[{seq:3,checkId:'old-check'}]);
  assert.deepEqual(model.state,imported);
});

test('Kupa file save with a V2 cloud cursor requires a journaled state and preserves its cursor',async()=>{
  const state={notes:[{id:'n',content:'journaled'}],checks:[]},model={state:clone(state)},session={connectionMode:'file',backendReady:true,dbRevision:3,localGeneration:1,serverInfo:{}};
  const calls=[],files={dataFileHandle:{name:'local.json'}};
  let fileRevision=3,journaled=clone(state);
  const storage=createKupaStoragePersistence({model,session,files,checksSession:{},storageV2Primary:()=>true,
    refreshStorageV2CloudState:async()=>({seq:1,base:{revision:8,ackSeq:0},pending:true}),recoverStorageV2State:async()=>({state:clone(journaled)}),
    normalizeState:clone,readJsonHandle:async()=>({_meta:{revision:fileRevision}}),stateFromPayload:()=>({state:clone(state)}),
    writeJsonHandleVerified:async(_handle,payload)=>calls.push(payload),replaceStorageV2CurrentState:async()=>{throw Error('cloud cursor must stay intact')},
    persistImmediateBrowserSnapshot:()=>{throw Error('legacy snapshot')},setSaveStatus:()=>{},reportError:()=>{},listBackups:async()=>[],toast:()=>{}});
  assert.equal(await storage.persistState(clone(state),'saved',1),true);
  assert.equal(calls.length,1);
  assert.equal(calls[0]._meta.revision,4);
  model.state.checks=[{id:'shared-check'}];fileRevision=4;
  assert.equal(await storage.persistState(clone(model.state),'shared check',1),true);
  assert.equal(calls.length,2,'Shared Checks may differ from the non-authoritative Main copy');
  const priorError=console.error;console.error=()=>{};
  try{
    journaled.notes[0].content='older than screen';
    assert.equal(await storage.persistState(clone(state),'unsafe',1),false);
    assert.equal(calls.length,2,'an unjournaled screen must not be written to the file');
    journaled=clone(state);fileRevision=6;
    assert.equal(await storage.persistState(clone(state),'external',1),false);
    assert.equal(calls.length,2,'an external file change must not bypass the journal');
    assert.equal(session.localFileConflictPending,true);
  }finally{console.error=priorError}
});
function fixture(){
  let record=null,owner='A',failPhase='',applyCount={shared:0,main:0};
  const db={
    async readBoundary(scoped){return scoped===record?.owner?clone(record):null},
    async beginBoundary(_owner,next){if(record&&record.phase!=='complete')throw new Error('pending');record=clone(next)},
    async advanceBoundary(_owner,id,from,to){if(record.id!==id||record.phase!==from)throw new Error('changed');if(failPhase===to){failPhase='';throw new Error('injected phase write failure')}record={...record,phase:to};return clone(record)},
    async completeBoundary(_owner,id){if(record.id!==id||record.phase!=='main-applied')throw new Error('changed');record={version:2,owner,id,kind:record.kind,phase:'complete'}},
  };
  const makeRuntime=side=>{let state={value:'old'},boundaryId=null,seq=0,control=null,revision=1;return {
    async recover(){return {state:clone(state),seq,appMetadata:{boundaryId}}},
    async cloudState(){return {base:{revision},pending:false,flight:null,control}},
    async replaceAuthoritativeState(next,options){state=clone(next);boundaryId=options.boundaryId||options.appMetadata?.boundaryId;applyCount[side]++;return {state}},
    async resetCloudHead(_revision,_cloud,currentOrOptions,options){state=clone(options?currentOrOptions:_cloud);boundaryId=(options||currentOrOptions).boundaryId||(options||currentOrOptions).appMetadata?.boundaryId;applyCount[side]++;return {state}},
    async replaceLocalWithPending(next,options){if(seq!==options.expectedSeq||revision!==options.expectedBaseRevision)throw new Error('storage_boundary_cloud_changed');state=clone(next);boundaryId=options.boundaryId;seq++;applyCount[side]++;return {seq}},
    get state(){return state},
    set seq(value){seq=value},
    set control(value){control=value},
    set revision(value){revision=value},
  }};
  const shared=makeRuntime('shared'),main=makeRuntime('main');
  const create=()=>createStorageV2Boundary({owner:()=>owner,primary:()=>true,main,shared,db});
  const action={id:'restore-123',kind:'restore',main:{kind:'replace-authoritative',state:{value:'new-main'}},shared:{kind:'replace-authoritative',state:{value:'new-shared'}}};
  return {create,action,main,shared,applyCount,get record(){return record},set failPhase(value){failPhase=value},set owner(value){owner=value}};
}

test('restore resumes after shared commit without applying Shared Checks twice',async()=>{
  const f=fixture(),coordinator=f.create();f.failPhase='shared-applied';
  await assert.rejects(coordinator.run(f.action),/injected/);
  assert.equal(coordinator.locked,true);
  assert.equal(f.shared.state.value,'new-shared');assert.equal(f.main.state.value,'old');assert.equal(f.record.phase,'prepared');
  const restarted=f.create();assert.equal(await restarted.pending(),true);
  assert.equal((await restarted.resume()).phase,'complete');
  assert.equal(restarted.locked,false);
  assert.deepEqual(f.applyCount,{shared:1,main:1});assert.equal(f.main.state.value,'new-main');
  assert.equal((await restarted.run(f.action)).phase,'complete');assert.deepEqual(f.applyCount,{shared:1,main:1});
});

test('restore resumes after Main commit without resetting its cloud head twice',async()=>{
  const f=fixture(),coordinator=f.create();f.failPhase='main-applied';
  const action={...f.action,main:{kind:'reset-cloud-head',revision:8,state:{value:'main cloud'},cloudState:{value:'main projection'}},shared:{kind:'reset-cloud-head',revision:10,state:{value:'shared cloud'}}};
  await assert.rejects(coordinator.run(action),/injected/);
  assert.equal(f.record.phase,'shared-applied');assert.equal(f.main.state.value,'main cloud');
  const restarted=f.create();await restarted.resume();assert.deepEqual(f.applyCount,{shared:1,main:1});assert.equal(f.record.phase,'complete');
});

test('pending restore rejects another operation and is scoped to its account',async()=>{
  const f=fixture(),coordinator=f.create();f.failPhase='shared-applied';await assert.rejects(coordinator.run(f.action));
  await assert.rejects(coordinator.run({...f.action,id:'another'}),/pending/);
  f.owner='B';const switched=f.create();assert.equal(await switched.pending(),false);
  assert.equal(await switched.resume(),null);assert.equal(f.record.owner,'A');assert.equal(f.main.state.value,'old');
  assert.equal(coordinator.locked,false);
});

test('stale restore source is rejected before any durable intent or journal replacement',async()=>{
  const f=fixture(),coordinator=f.create();f.shared.seq=2;
  await assert.rejects(coordinator.run({...f.action,shared:{...f.action.shared,expectedSeq:1},main:{...f.action.main,expectedSeq:0}}),/source_changed/);
  assert.equal(f.record,null);assert.deepEqual(f.applyCount,{shared:0,main:0});assert.equal(coordinator.locked,false);
});

test('cloud control created during remote restore blocks local reset before intent',async()=>{
  const f=fixture(),coordinator=f.create();f.shared.control={conflict:{kind:'same-check'}};
  await assert.rejects(coordinator.run({...f.action,shared:{...f.action.shared,expectedSeq:0,requireCleanCloud:true},main:{...f.action.main,expectedSeq:0,requireCleanCloud:true}}),/cloud_changed/);
  assert.equal(f.record,null);assert.deepEqual(f.applyCount,{shared:0,main:0});assert.equal(coordinator.locked,false);
});

test('remote head change during restore blocks a stale local reset',async()=>{
  const f=fixture(),coordinator=f.create();f.main.revision=2;
  await assert.rejects(coordinator.run({...f.action,shared:{...f.action.shared,expectedSeq:0,expectedBaseRevision:1,requireCleanCloud:true},main:{...f.action.main,expectedSeq:0,expectedBaseRevision:1,requireCleanCloud:true}}),/cloud_changed/);
  assert.equal(f.record,null);assert.deepEqual(f.applyCount,{shared:0,main:0});
});

test('local import resumes after Shared commit and leaves one pending operation per journal',async()=>{
  const f=fixture(),coordinator=f.create();f.failPhase='shared-applied';
  const source={kind:'replace-local-with-pending',expectedSeq:0,expectedBaseRevision:1,requireCleanCloud:true};
  const action={id:'import-1',kind:'import',main:{...source,state:{value:'imported-main'}},shared:{...source,state:{value:'imported-shared'}}};
  await assert.rejects(coordinator.run(action),/injected/);
  assert.equal(f.shared.state.value,'imported-shared');assert.equal(f.main.state.value,'old');
  const restarted=f.create();await restarted.resume();
  assert.deepEqual(f.applyCount,{shared:1,main:1});
  assert.equal((await restarted.run(action)).phase,'complete');
  assert.deepEqual(f.applyCount,{shared:1,main:1});
});

test('a preflight IDB failure releases the edit gate before a boundary is durable',async()=>{
  const f=fixture(),coordinator=createStorageV2Boundary({owner:()=> 'A',primary:()=>true,main:f.main,shared:f.shared,db:{readBoundary:async()=>{throw new Error('transient IDB read')}}});
  await assert.rejects(coordinator.run(f.action),/transient IDB read/);
  assert.equal(coordinator.locked,false);
});

test('local import cannot silently discard its cloud cursor',async()=>{
  const f=fixture();
  await assert.rejects(f.create().run({...f.action,kind:'import'}),/import_requires_pending/);
  assert.equal(f.record,null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoragePersistence as createOrdersPersistence} from '../netunim-orders/site/assets/js/storage/persistence.js';
import {createStoragePersistence as createKupaPersistence} from '../netunim-kupa/site/assets/js/storage/persistence.js';
import {createSyncChecksPersistence} from '../netunim-orders/site/assets/js/sync/checks-persistence.js';
import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';
import {createStorageShadow} from '../shared/storage-shadow.js';
import {INITIAL_STATE as ordersInitial} from '../netunim-orders/site/assets/js/state/constants.js';
import {INITIAL_STATE as kupaInitial} from '../netunim-kupa/site/assets/js/state/constants.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';

const noop=()=>{};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('Orders waits for an IDB-only journal commit even if the cloud cursor becomes unavailable',async()=>{
  const commit=deferred(),sent=[],status=[],model={state:structuredClone(ordersInitial)};
  let cloudCursor=true;
  const session={localGeneration:0,ordersOutboxCommitPromise:Promise.resolve()};
  const persistence=createOrdersPersistence({
    model,tab:{primaryTab:true},session,domainRevisions:{touch:noop},localSnapshot:()=>false,
    storageV2CloudOutboxActive:()=>cloudCursor,storageV2CommitPromise:()=>commit.promise,storageV2DurabilityAtRisk:()=>true,
    setSave:value=>status.push(value),setCloud:noop,folderSaveTitle:()=>'',folderBackupAvailable:()=>false,
    syncFolderAccessButton:noop,cloudEnabled:()=>true,markCloudPending:noop,requestCloudSave:async()=>{sent.push('sent');return true},
  });
  assert.equal(persistence.scheduleSave('edit',{domains:['notes'],operations:[{type:'put',collection:'notes',id:'N1',record:{id:'N1'}}]}),false);
  cloudCursor=false;
  await new Promise(resolve=>setTimeout(resolve,220));
  assert.deepEqual(sent,[]);
  commit.resolve();await tick();
  assert.deepEqual(sent,['sent']);
  assert.ok(status.some(value=>value.includes('IndexedDB')));
});

test('Orders does not send an edit whose IDB-only journal commit fails',async()=>{
  const commit=deferred(),sent=[],model={state:structuredClone(ordersInitial)},session={localGeneration:0,ordersOutboxCommitPromise:Promise.resolve()};
  const persistence=createOrdersPersistence({
    model,tab:{primaryTab:true},session,domainRevisions:{touch:noop},localSnapshot:()=>false,
    storageV2CloudOutboxActive:()=>false,storageV2CommitPromise:()=>commit.promise,storageV2DurabilityAtRisk:()=>true,
    setSave:noop,setCloud:noop,folderSaveTitle:()=>'',folderBackupAvailable:()=>false,
    syncFolderAccessButton:noop,cloudEnabled:()=>true,markCloudPending:noop,requestCloudSave:async()=>{sent.push('sent')},
  });
  persistence.scheduleSave('edit',{domains:['notes'],operations:[{type:'put',collection:'notes',id:'N1',record:{id:'N1'}}]});
  await new Promise(resolve=>setTimeout(resolve,220));
  commit.reject(new Error('injected IDB failure'));await tick();
  assert.deepEqual(sent,[]);
  assert.equal(session.localUndurableGenerations?.size,1);
});

test('Kupa does not stage or send cloud work before an IDB-only journal commit',async()=>{
  const commit=deferred(),staged=[],sent=[],model={state:structuredClone(kupaInitial)};
  const normalization=createStateNormalization({model});model.state=normalization.normalizeState(model.state);
  const session={localGeneration:0,dbRevision:1,connectionMode:'supabase',backendReady:true,saveQueue:Promise.resolve()};
  const persistence=createKupaPersistence({
    model,session,tab:{primaryTab:true},files:{},checksSession:{},domainRevisions:{touch:noop},
    storageV2Primary:()=>true,storageV2CloudOutboxActive:()=>false,storageV2CommitPromise:()=>commit.promise,storageV2DurabilityAtRisk:()=>true,
    persistImmediateBrowserSnapshot:()=>false,normalizeState:normalization.normalizeState,prepareKupaCloudState:normalization.prepareKupaCloudState,
    lastSavedCloudState:()=>null,stageCloudPendingLocal:()=>staged.push('staged'),persistSupabaseState:async()=>{sent.push('sent');return true},
    setSaveStatus:noop,
  });
  const saving=persistence.saveState('edit',{domains:['notes'],operations:[{type:'put',collection:'notes',id:'N1',record:{id:'N1'}}]});
  await tick();await tick();assert.deepEqual(staged,[]);assert.deepEqual(sent,[]);
  commit.resolve();assert.equal(await saving,true);
  assert.deepEqual(staged,['staged']);assert.deepEqual(sent,['sent']);
});

test('Orders shared checks do not start a cloud write before an IDB-only journal commit',async()=>{
  const commit=deferred(),sent=[],checksSession={},session={localGeneration:0},model={state:{checks:[{id:'C1'}]}};
  const persistence=createSyncChecksPersistence({
    model,session,checksSession,localSnapshot:()=>false,storageV2:{get durabilityAtRisk(){return true},get commitPromise(){return commit.promise}},
    markChecksPending:noop,toast:noop,setSave:noop,folderSaveTitle:()=>'',rejectSecondaryMutation:()=>false,
    folderBackupAvailable:()=>false,syncFolderAccessButton:noop,loadSession:()=>({user:{id:'A'}}),
    saveSharedChecksToCloud:async()=>{sent.push('sent');return true},
  });
  persistence.scheduleCheckSave('edit',{operations:[{type:'put',collection:'checks',id:'C1',record:{id:'C1'}}]});
  await new Promise(resolve=>setTimeout(resolve,290));assert.deepEqual(sent,[]);
  commit.resolve();await tick();assert.deepEqual(sent,['sent']);
});

test('Kupa shared checks do not start a cloud write when the IDB-only journal commit fails',async()=>{
  const commit=deferred(),sent=[],model={state:structuredClone(kupaInitial)};
  const normalization=createStateNormalization({model});model.state=normalization.normalizeState(model.state);
  const checksSession={sharedChecksGeneration:0},session={localGeneration:0,dbRevision:1,connectionMode:'supabase',backendReady:true,saveQueue:Promise.resolve()};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  const persistence=createKupaPersistence({
    model,session,checksSession,tab:{primaryTab:true},files:{},domainRevisions:{touch:noop},storageV2Primary:()=>true,
    storageV2CommitPromise:()=>commit.promise,storageV2DurabilityAtRisk:()=>true,persistImmediateBrowserSnapshot:()=>false,
    normalizeState:normalization.normalizeState,markSharedChecksPending:noop,saveSharedChecksToCloud:async()=>{sent.push('sent')},
    setSaveStatus:noop,
  });
  const saving=persistence.saveChecksState('edit',{operations:[{type:'put',collection:'checks',id:'C1',record:{id:'C1'}}]});
  await new Promise(resolve=>setTimeout(resolve,250));assert.deepEqual(sent,[]);
  commit.reject(new Error('injected IDB failure'));
  assert.equal(await saving,false);await tick();assert.deepEqual(sent,[]);
});

test('Kupa reports a failed legacy rescue outbox without an unhandled cloud-save rejection',async()=>{
  const model={state:structuredClone(kupaInitial)},statuses=[],sent=[],session={localGeneration:0,dbRevision:1,connectionMode:'supabase',backendReady:true,saveQueue:Promise.resolve()};
  const normalization=createStateNormalization({model});model.state=normalization.normalizeState(model.state);
  const persistence=createKupaPersistence({
    model,session,
    tab:{primaryTab:true},files:{},checksSession:{},domainRevisions:{touch:noop},storageV2Primary:()=>true,
    storageV2CloudOutboxActive:()=>true,storageV2DurabilityAtRisk:()=>false,persistImmediateBrowserSnapshot:()=>false,
    normalizeState:normalization.normalizeState,prepareKupaCloudState:normalization.prepareKupaCloudState,
    lastSavedCloudState:()=>null,stageCloudPendingLocal:()=>{throw new Error('injected outbox failure')},
    persistSupabaseState:async()=>{sent.push('sent')},setSaveStatus:value=>statuses.push(value),
  });
  const original=console.error;console.error=noop;
  try{assert.equal(await persistence.saveState('edit',{domains:['notes'],operations:[{type:'put',collection:'notes',id:'N1',record:{id:'N1'}}]}),false)}
  finally{console.error=original}
  assert.deepEqual(sent,[]);assert.ok(statuses.some(value=>value.includes('אין לסגור')));
  assert.equal(session.localUndurableGenerations?.size,1);
});

test('an account change cannot clear an uncommitted IDB-only mutation guard',async()=>{
  const commit=deferred(),predicates=[],installs=[];let owner='A';
  const runtime=createStorageV2Runtime({app:'orders',owner:()=>owner,primary:()=>true,validate:noop,mode:()=> 'primary',createJournal:options=>{predicates.push(options.primary);return ({
    ready:true,open:async()=>({state:{notes:[]},appMetadata:{storageRole:'primary',snapshotSeq:0},seq:0,stored:{checkpoints:{data:{seq:0}}}}),
    append:()=>({emergencyDurable:false,committed:commit.promise,seq:1}),settled:()=>Promise.resolve(),install:async()=>{installs.push(options.owner)},
  })}});
  await runtime.recover();
  runtime.persist({notes:[{id:'N1'}]},{operations:[{type:'put',collection:'notes',id:'N1',record:{id:'N1'}}]});
  assert.equal(runtime.durabilityAtRisk,true);
  owner='B';await runtime.recover();
  assert.equal(runtime.durabilityAtRisk,true);
  assert.equal(predicates[0](),false);
  assert.equal(predicates[1](),true);
  commit.resolve();await tick();
  assert.equal(runtime.durabilityAtRisk,false);
  runtime.afterLegacy({notes:[]},{storageBoundary:'remote-authoritative-load'});
  await runtime.commitPromise;
  assert.deepEqual(installs,['B:orders']);
});

test('overlapping recoveries remain scoped to the account that started them',async()=>{
  const firstOpen=deferred(),record={state:{notes:[]},appMetadata:{storageRole:'primary',snapshotSeq:0},seq:0,stored:{checkpoints:{data:{seq:0}}}};
  let owner='A',bOpens=0;
  const runtime=createStorageV2Runtime({app:'orders',owner:()=>owner,primary:()=>true,validate:noop,mode:()=> 'primary',createJournal:options=>({
    ready:true,open:()=>options.owner.startsWith('A:')?firstOpen.promise:(bOpens++,Promise.resolve(record)),settled:()=>Promise.resolve(),
  })});
  const oldRecovery=runtime.recover();owner='B';
  const current=await runtime.recover();assert.equal(current?.source,'v2');
  firstOpen.reject(new Error('old account failed'));
  assert.equal(await oldRecovery,null);
  assert.equal((await runtime.recover())?.source,'v2');
  assert.equal(bOpens,2);
});

test('shadow journal writer fencing also follows the journal owner across account changes',async()=>{
  let owner='A';const predicates=[];
  const shadow=createStorageShadow({app:'orders',owner:()=>owner,primary:()=>true,validate:noop,enabled:()=>true,schedule:noop,createJournal:options=>{
    predicates.push(options.primary);return {ready:false,open:async()=>null,install:async()=>{}};
  }});
  shadow.observe({notes:[]},{storageBoundary:'initial'});await shadow.flush();
  owner='B';shadow.observe({notes:[]},{storageBoundary:'account-change'});await shadow.flush();
  assert.equal(predicates[0](),false);assert.equal(predicates[1](),true);
});

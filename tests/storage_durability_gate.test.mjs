import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoragePersistence as createOrdersPersistence} from '../netunim-orders/site/assets/js/storage/persistence.js';
import {createStoragePersistence as createKupaPersistence} from '../netunim-kupa/site/assets/js/storage/persistence.js';
import {createSyncChecksPersistence} from '../netunim-orders/site/assets/js/sync/checks-persistence.js';
import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';
import {INITIAL_STATE as ordersInitial} from '../netunim-orders/site/assets/js/state/constants.js';
import {INITIAL_STATE as kupaInitial} from '../netunim-kupa/site/assets/js/state/constants.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';

const noop=()=>{};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('transient IndexedDB recovery failure retries without reload, corruption remains fail-closed',async()=>{
  for(const message of ['storage_transaction_aborted','storage_checksum_mismatch']){
    let calls=0;
    const runtime=createStorageV2Runtime({app:'orders',owner:()=> 'A',primary:()=>true,validate:noop,mode:()=> 'primary',createJournal:()=>({ready:true,
      open:async()=>{calls++;if(calls===1)throw new Error(message);return {state:{notes:[]},epoch:'E',seq:0,appMetadata:{storageRole:'primary'}}},
    })});
    assert.equal(await runtime.recover(),null);
    const recovered=await runtime.recover();assert.equal(!!recovered,message!=='storage_checksum_mismatch');
    assert.equal(calls,message==='storage_checksum_mismatch'?1:2);
  }
});

test('verified recovery clears only a recovered failed sequence and repairs the rejected commit queue',async()=>{
  let recoveredSeq=0;
  const runtime=createStorageV2Runtime({app:'orders',owner:()=> 'A',primary:()=>true,validate:noop,mode:()=> 'primary',createJournal:()=>({ready:true,epoch:'E',
    open:async()=>({state:{notes:[]},epoch:'E',seq:recoveredSeq,appMetadata:{storageRole:'primary'}}),
    append:()=>({seq:1,emergencyDurable:false,committed:Promise.reject(new Error('commit response lost'))}),settled:async()=>true,
  })});
  await runtime.recover();const write=runtime.persist({notes:[]},{operations:[{type:'set',field:'settings',value:{}}]});
  await assert.rejects(write.committed);await assert.rejects(runtime.commitPromise);assert.equal(runtime.durabilityAtRisk,true);
  await runtime.recover();assert.equal(runtime.durabilityAtRisk,true,'a successful open of an older state cannot conceal a lost edit');
  recoveredSeq=1;await runtime.recover();assert.equal(runtime.durabilityAtRisk,false);assert.equal(await runtime.flush(),true);
});

test('Main owner handoff never migrates the currently visible account implicitly',async()=>{
  let owner='A';const installs=[];
  const runtime=createStorageV2Runtime({app:'orders',owner:()=>owner,primary:()=>true,validate:noop,mode:()=> 'primary',createJournal:options=>({ready:false,
    open:async()=>null,install:async state=>installs.push({owner:options.owner,state}),recover:async()=>({state:{notes:[]},seq:0}),
  })});
  await runtime.recover({notes:[{id:'A'}]});assert.equal(installs.length,1);
  owner='B';assert.equal(await runtime.recover({notes:[{id:'A'}]}),null);assert.equal(installs.length,1);
  await assert.rejects(runtime.recoverForOwner({intent:'upload-local',sourceOwner:'A',state:{notes:[{id:'A'}]}}),/transfer_intent/);
  await runtime.recoverForOwner({intent:'legacy-upgrade',sourceOwner:'B',state:{notes:[{id:'B'}]}});
  assert.equal(installs.length,2);assert.equal(installs[1].owner,'B:orders');assert.equal(installs[1].state.notes[0].id,'B');
});

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
  const commit=deferred(),predicates=[],replacements=[];let owner='A';
  const runtime=createStorageV2Runtime({app:'orders',owner:()=>owner,primary:()=>true,validate:noop,mode:()=> 'primary',createJournal:options=>{predicates.push(options.primary);return ({
    ready:true,open:async()=>({state:{notes:[]},appMetadata:{storageRole:'primary',snapshotSeq:0},seq:0,stored:{checkpoints:{data:{seq:0}}}}),
    append:()=>({emergencyDurable:false,committed:commit.promise,seq:1}),settled:()=>Promise.resolve(),replaceCurrentState:async()=>{replacements.push(options.owner)},
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
  await runtime.replaceCurrentState({notes:[]});
  assert.deepEqual(replacements,['B:orders']);
});

test('an owner switch immediately fences the old V2 cloud cursor before the new owner recovers',async()=>{
  let owner='A';const seen=[],commit=deferred();
  const runtime=createStorageV2Runtime({app:'orders',owner:()=>owner,primary:()=>true,validate:noop,mode:()=> 'primary',createJournal:options=>{
    const journal={ready:false,open:async()=>{journal.ready=true;return {state:{notes:[]},appMetadata:{storageRole:'primary',snapshotSeq:0},seq:0,stored:{checkpoints:{data:{seq:0}}}}},append:()=>({emergencyDurable:true,committed:commit.promise,seq:1}),cloudState:async()=>{seen.push(options.owner);return {base:{revision:1}}},settled:()=>Promise.resolve()};return journal;
  }});
  await runtime.recover();assert.equal(runtime.primaryReady,true);assert.equal((await runtime.cloudState()).base.revision,1);
  runtime.persist({notes:[{id:'N1'}]},{operations:[{type:'put',collection:'notes',id:'N1',record:{id:'N1'}}]});const inFlightRead=runtime.cloudState();
  owner='B';assert.equal(runtime.primaryReady,false);assert.equal(await runtime.cloudState(),null);assert.deepEqual(seen,['A:orders']);
  await runtime.recover();commit.resolve();await assert.rejects(inFlightRead,/storage_owner_changed_during_operation/);
  assert.equal(runtime.primaryReady,true);assert.equal((await runtime.cloudState()).base.revision,1);assert.deepEqual(seen,['A:orders','B:orders']);
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


test('Main Storage V2 read-only recovery never opens or claims the writer journal',async()=>{
  let opened=0,recovered=0;
  const runtime=createStorageV2Runtime({app:'orders',owner:()=> 'A',primary:()=>false,validate:noop,mode:()=> 'primary',createJournal:()=>({
    ready:false,
    open:async()=>{opened++;throw new Error('writer open must not run')},
    recover:async()=>{recovered++;return {state:{notes:[]},appMetadata:{storageRole:'primary',snapshotSeq:2},seq:3,stored:{checkpoints:{data:{seq:2}}}}},
  })});
  assert.equal(await runtime.recover(),null);
  const result=await runtime.recoverReadOnly();
  assert.equal(result?.source,'v2-readonly');
  assert.equal(opened,0);
  assert.equal(recovered,1);
  assert.equal(runtime.primaryReady,false);
});

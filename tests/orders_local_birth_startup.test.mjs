import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifecycle} from '../netunim-orders/site/assets/js/lifecycle.js';

function fixture(overrides={}){
  const calls=[],session={},tab={primaryTab:true};
  let marker=false;
  const ports={
    model:{state:{checks:[]}},files:{},tab,session,checksSession:{},ui:{currentView:'orders'},
    hydrateStorageOwner:async()=>calls.push('owner'),
    hydrateStorageTransition:async()=>calls.push('account-transition'),
    hydrateLocalBirth:async()=>calls.push('birth-hydrated'),
    storageOwnerCurrent:()=> 'local',
    verifyStorageCutover:async()=>false,
    verifyLocalStorageEngine:async()=>marker,
    ensureLocalBirth:async()=>{calls.push('birth');marker=true},
    recoverLocalV2State:async()=>{calls.push('main-v2');return {state:{checks:[]}}},
    restoreBrowserStateFallback:async()=>{throw new Error('V1 fallback reached')},
    recoverSharedChecksV2Primary:async()=>{calls.push('shared-v2');return true},
    acquirePrimaryTabLock:async()=>calls.push('tab-lock'),
    loadSession:()=>null,cloudEnabled:()=>false,
    render:()=>calls.push('render'),
    setSave:()=>{},setCloud:()=>{},syncFolderAccessButton:()=>{},
    requestPersistentBrowserStorage:async()=>{},loadDirHandle:async()=>null,
    folderBackupAvailable:()=>false,folderSaveTitle:()=>'',prepareStartupAlerts:async()=>false,
    showStartupAlerts:()=>{},startFinanceAutoSync:()=>{},
    ...overrides,
  };
  return {lifecycle:createLifecycle(ports),calls,session,setMarker:value=>{marker=value}};
}

test('Orders fresh local startup commits birth then hydrates both V2 journals before render',async()=>{
  const f=fixture();await f.lifecycle.boot();await f.session.startupHydrationPromise;
  assert.deepEqual(f.calls.slice(0,8),['tab-lock','owner','account-transition','birth-hydrated','birth','main-v2','shared-v2','render']);
  assert.equal(f.session.storageProtocolBlocked,false);
});

test('Orders restart with local marker recovers V2 without rereading V1 or rerunning birth',async()=>{
  const f=fixture();f.setMarker(true);await f.lifecycle.boot();await f.session.startupHydrationPromise;
  assert.equal(f.calls.includes('birth'),false);
  assert.ok(f.calls.indexOf('main-v2')<f.calls.indexOf('shared-v2'));
  assert.ok(f.calls.indexOf('shared-v2')<f.calls.indexOf('render'));
});

test('Orders interrupted local birth keeps the business model off screen and locked',async()=>{
  const status=[],f=fixture({ensureLocalBirth:async()=>{throw new Error('idb-transient')},setSave:(message,kind)=>status.push({message,kind})});
  await f.lifecycle.boot();
  assert.equal(f.calls.includes('render'),false);
  assert.equal(f.calls.includes('main-v2'),false);
  assert.equal(status.at(-1)?.kind,'error');
});

test('Orders local secondary tab never renders a V1 snapshot while primary birth may be active',async()=>{
  const f=fixture({tab:{primaryTab:false},showSecondaryTabGuard:()=>{},recoverLocalV2State:async()=>{throw new Error('secondary V2 recovery')}});
  await f.lifecycle.boot();
  assert.equal(f.calls.includes('birth'),false);
  assert.equal(f.calls.includes('render'),false);
});

test('Orders missing Shared V2 checkpoint fails before business render',async()=>{
  const f=fixture({recoverSharedChecksV2Primary:async()=>false});f.setMarker(true);
  await assert.rejects(f.lifecycle.boot(),/shared_v2_recovery_required/);
  assert.equal(f.calls.includes('render'),false);
});

test('Orders resumes a durable owner transfer before V1 fallback or business render',async()=>{
  const f=fixture({
    hydrateStorageV2OwnerTransfer:async()=>({phase:'target-recovered'}),
    resumeStorageV2OwnerTransfer:async()=>f.calls.push('transfer-resumed'),
    storageOwnerCurrent:()=> 'account',verifyStorageCutover:async()=>true,
    restoreBrowserStateFallback:async()=>f.calls.push('account-main-recovered'),
    refreshStorageV2CloudState:async()=>({base:{state:{checks:[]},revision:1},seq:0,pending:false,flight:null,control:null}),
  });
  await f.lifecycle.boot();await f.session.startupHydrationPromise;
  assert.ok(f.calls.indexOf('transfer-resumed')<f.calls.indexOf('account-main-recovered'));
  assert.ok(f.calls.indexOf('account-main-recovered')<f.calls.indexOf('render'));
});

test('Orders missing target authentication keeps a pending transfer locked off screen',async()=>{
  const f=fixture({
    hydrateStorageV2OwnerTransfer:async()=>({phase:'target-recovered'}),
    resumeStorageV2OwnerTransfer:async()=>{throw new Error('storage_transfer_target_reauth_required')},
    storageOwnerCurrent:()=> 'local',
  });
  await f.lifecycle.boot();
  assert.equal(f.calls.includes('birth'),false);
  assert.equal(f.calls.includes('render'),false);
});

test('Orders unmarked browser for a fenced account stops before V1 recovery and render',async()=>{
  const f=fixture({storageOwnerCurrent:()=> 'account',authenticatedOwner:()=> 'account',readStorageProtocolState:async()=>({orders:2,kupa:2,sharedChecks:2}),
    restoreBrowserStateFallback:async()=>{throw Error('stale V1 loaded')},render:()=>{throw Error('stale state displayed')}});
  await f.lifecycle.boot();
  assert.equal(f.calls.includes('birth'),false);
  assert.equal(f.calls.includes('render'),false);
  assert.equal(f.calls.includes('main-v2'),false);
  assert.equal(f.session.storageProtocolBlocked,true);
});

test('Orders local V1 browser with a saved fenced-account session stops before local birth',async()=>{
  const f=fixture({authenticatedOwner:()=> 'account',readStorageProtocolState:async()=>({orders:2,kupa:2,sharedChecks:2}),
    ensureLocalBirth:async()=>{throw Error('stale local V1 migrated')}});
  await f.lifecycle.boot();
  assert.equal(f.calls.includes('birth'),false);
  assert.equal(f.calls.includes('render'),false);
  assert.equal(f.session.storageProtocolBlocked,true);
});

test('Orders with an account cutover hydrates Shared before a DB capability failure renders Main',async()=>{
  const model={state:{checks:[{id:'stale-main-copy'}]}},f=fixture({
    model,storageOwnerCurrent:()=> 'account',verifyStorageCutover:async()=>true,
    loadSession:()=>({access_token:'present'}),cloudEnabled:()=>true,
    restoreBrowserStateFallback:async()=>f.calls.push('main-v2'),
    recoverSharedChecksV2Primary:async()=>{f.calls.push('shared-v2');model.state.checks=[{id:'authoritative-shared-copy'}];return true},
    ensureSyncCapabilities:async()=>{f.calls.push('capability-check');throw new Error('DB upgrade required')},
    render:()=>f.calls.push(`render:${model.state.checks[0]?.id}`),
  });
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  try{
    await f.lifecycle.boot();
    assert.ok(f.calls.indexOf('shared-v2')<f.calls.indexOf('capability-check'));
    assert.ok(f.calls.includes('render:authoritative-shared-copy'));
    assert.equal(f.calls.includes('render:stale-main-copy'),false);
    assert.equal(f.session.syncCapabilitiesError?.message,'DB upgrade required');
  }finally{
    if(previous)Object.defineProperty(globalThis,'navigator',previous);
    else delete globalThis.navigator;
  }
});

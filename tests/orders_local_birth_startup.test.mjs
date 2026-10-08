import {withStorageProtocol} from './startup_ports.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifecycle} from '../netunim-orders/site/assets/js/lifecycle.js';

function fixture(overrides={}){
  const calls=[],session={},tab={primaryTab:true};
  let marker=false;
  const ports={
    model:{state:{checks:[]}},files:{},tab,session,checksSession:{},ui:{currentView:'orders'},
    hydrateStorageOwner:async()=>calls.push('owner'),
    hydrateLocalBirth:async()=>calls.push('birth-hydrated'),
    storageOwnerCurrent:()=> 'local',
    verifyStorageV2AccountMarker:async()=>false,
    verifyLocalStorageEngine:async()=>marker,
    ensureLocalBirth:async()=>{calls.push('birth');marker=true},
    recoverLocalV2State:async()=>{calls.push('main-v2');return {state:{checks:[]}}},
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
  return {lifecycle:createLifecycle(withStorageProtocol(ports)),calls,session,setMarker:value=>{marker=value}};
}

test('Orders fresh local startup commits birth then hydrates both V2 journals before render',async()=>{
  const f=fixture();const boot=f.lifecycle.boot();assert.equal(f.lifecycle.boot(),boot);await boot;await f.session.startupHydrationPromise;await f.lifecycle.boot();
  assert.deepEqual(f.calls.slice(0,7),['tab-lock','owner','birth-hydrated','birth','main-v2','shared-v2','render']);
  assert.equal(f.session.storageProtocolBlocked,false);
  assert.equal(f.calls.filter(value=>value==='render').length,1);
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
  await assert.rejects(f.lifecycle.boot(),/startup_shared_recovery_required/);
  assert.equal(f.calls.includes('render'),false);
});

test('Orders resumes a durable owner transfer before Main V2 recovery or business render',async()=>{
  const f=fixture({
    hydrateStorageV2OwnerTransfer:async()=>({phase:'target-recovered'}),
    resumeStorageV2OwnerTransfer:async()=>f.calls.push('transfer-resumed'),
    storageOwnerCurrent:()=> 'account',verifyStorageV2AccountMarker:async()=>true,
    recoverLocalV2State:async()=>f.calls.push('account-main-recovered'),
    refreshStorageV2CloudState:async()=>({base:{state:{checks:[]},revision:1},seq:0,pending:false,flight:null,control:null}),
  });
  await f.lifecycle.boot();await f.session.startupHydrationPromise;
  assert.ok(f.calls.indexOf('transfer-resumed')<f.calls.indexOf('account-main-recovered'));
  assert.ok(f.calls.indexOf('account-main-recovered')<f.calls.indexOf('render'));
});

test('Orders resumed local-to-account transfer uses the activated owner for Main recovery',async()=>{
  let owner='local';
  const f=fixture({
    storageOwnerCurrent:()=>owner,
    verifyStorageV2AccountMarker:async()=>owner==='account',
    verifyLocalStorageEngine:async()=>owner==='local',
    hydrateStorageV2OwnerTransfer:async()=>({phase:'target-recovered'}),
    resumeStorageV2OwnerTransfer:async()=>{f.calls.push('transfer-resumed');owner='account'},
    ensureLocalBirth:async()=>assert.fail('account target must not enter local birth'),
    recoverLocalV2State:async()=>{assert.equal(owner,'account');f.calls.push('account-main');return {state:{checks:[]}}},
    refreshStorageV2CloudState:async()=>({base:{state:{checks:[]},revision:4},seq:0,pending:false,flight:null,control:null}),
  });
  await f.lifecycle.boot();await f.session.startupHydrationPromise;
  assert.deepEqual(f.calls.slice(0,7),['tab-lock','owner','birth-hydrated','transfer-resumed','account-main','shared-v2','render']);
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
    recoverLocalV2State:async()=>{throw Error('stale local checkpoint loaded')},render:()=>{throw Error('stale state displayed')}});
  await f.lifecycle.boot();
  assert.equal(f.calls.includes('birth'),false);
  assert.equal(f.calls.includes('render'),false);
  assert.equal(f.calls.includes('main-v2'),false);
  assert.equal(f.session.storageProtocolBlocked,true);
});

test('Orders fenced stale browser installs cloud V2 before any business render',async()=>{
  let marker=false;const f=fixture({storageOwnerCurrent:()=> 'account',authenticatedOwner:()=> 'account',
    readStorageProtocolState:async()=>({orders:2,kupa:2,sharedChecks:2}),verifyStorageV2AccountMarker:async()=>marker,
    recoverFencedAccount:async()=>{f.calls.push('cloud-adoption');marker=true},
    recoverLocalV2State:async()=>{assert.equal(marker,true);f.calls.push('main-v2');return {state:{checks:[]}}},
    refreshStorageV2CloudState:async()=>({base:{state:{},revision:7},seq:0,pending:false,flight:null,control:null}),
  });
  await f.lifecycle.boot();await f.session.startupHydrationPromise;
  assert.ok(f.calls.indexOf('cloud-adoption')<f.calls.indexOf('main-v2'));
  assert.ok(f.calls.indexOf('main-v2')<f.calls.indexOf('shared-v2'));
  assert.ok(f.calls.indexOf('shared-v2')<f.calls.indexOf('render'));
  assert.equal(f.session.storageProtocolBlocked,false);
});

test('Orders local V1 browser with a saved fenced-account session stops before local birth',async()=>{
  const f=fixture({authenticatedOwner:()=> 'account',readStorageProtocolState:async()=>({orders:2,kupa:2,sharedChecks:2}),
    ensureLocalBirth:async()=>{throw Error('stale local V1 migrated')}});
  await f.lifecycle.boot();
  assert.equal(f.calls.includes('birth'),false);
  assert.equal(f.calls.includes('render'),false);
  assert.equal(f.session.storageProtocolBlocked,true);
});

test('Orders stale local binding adopts a fenced account before local birth or V1 render',async()=>{
  let owner='local',marker=false;
  const f=fixture({storageOwnerCurrent:()=>owner,authenticatedOwner:()=> 'account',
    readStorageProtocolState:async()=>({orders:2,kupa:2,sharedChecks:2}),verifyStorageV2AccountMarker:async()=>marker,
    recoverFencedAccount:async()=>{f.calls.push('cloud-adoption');owner='account';marker=true},
    ensureLocalBirth:async()=>{throw Error('stale local V1 migrated')},
    recoverLocalV2State:async()=>{assert.equal(owner,'account');f.calls.push('main-v2');return {state:{checks:[]}}},
    refreshStorageV2CloudState:async()=>({base:{state:{},revision:7},seq:0,pending:false,flight:null,control:null}),
  });
  await f.lifecycle.boot();await f.session.startupHydrationPromise;
  assert.ok(f.calls.indexOf('cloud-adoption')<f.calls.indexOf('main-v2'));
  assert.ok(f.calls.indexOf('main-v2')<f.calls.indexOf('shared-v2'));
  assert.equal(f.calls.includes('birth'),false);
  assert.equal(f.session.storageProtocolBlocked,false);
});

test('Orders with an account cutover hydrates Shared before a DB capability failure renders Main',async()=>{
  const model={state:{checks:[{id:'stale-main-copy'}]}},f=fixture({
    model,storageOwnerCurrent:()=> 'account',verifyStorageV2AccountMarker:async()=>true,
    loadSession:()=>({access_token:'present'}),cloudEnabled:()=>true,
    recoverLocalV2State:async()=>f.calls.push('main-v2'),
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

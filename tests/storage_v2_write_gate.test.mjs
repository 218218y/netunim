import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageChecks} from '../netunim-orders/site/assets/js/storage/checks.js';
import {createSyncChecksState} from '../netunim-kupa/site/assets/js/sync/checks-state.js';
import {createStorageBrowser as createOrdersBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';
import {createStorageBrowser as createKupaBrowser} from '../netunim-kupa/site/assets/js/storage/browser.js';
import {createStoragePending} from '../netunim-kupa/site/assets/js/storage/pending.js';
import {createStorageV2Cutover,storageCutoverKey} from '../shared/storage-v2-cutover.js';
import {createLifecycle as createOrdersLifecycle} from '../netunim-orders/site/assets/js/lifecycle.js';
import {createSyncRecovery} from '../netunim-kupa/site/assets/js/sync/recovery.js';
import {createUiCloud as createOrdersUiCloud} from '../netunim-orders/site/assets/js/ui/cloud.js';
import {createUiCloud as createKupaUiCloud} from '../netunim-kupa/site/assets/js/ui/cloud.js';

function localStore(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),get length(){return values.size},key:index=>[...values.keys()][index]??null}}

test('V2 owner handoff routes first-cloud UI through V2 and never stages a V1 outbox',async()=>{
  const prior=globalThis.localStorage,priorAlert=globalThis.alert,priorDocument=globalThis.document;
  globalThis.localStorage=localStore();globalThis.alert=()=>{};globalThis.document={getElementById:()=>({style:{display:'flex'}})};
  let writes=0,transfers=0,ordersOwner='local',kupaOwner='local';
  try{
    const orders=createOrdersUiCloud({tab:{primaryTab:true},session:{},supaConfigured:()=>true,loadSession:()=>({user:{id:'account'}}),
      setCloud:()=>{},toast:()=>{},getCloudPending:async()=>null,readCloud:async()=>null,refreshStorageV2CloudState:async()=>null,
      storageOwnerCurrent:()=>ordersOwner,storageV2PrimaryRequested:()=>true,markCloudPending:()=>{writes++},requestCloudSave:async()=>{writes++},
      startStorageV2OwnerTransfer:async({targetOwner,intent})=>{assert.equal(targetOwner,'account');assert.equal(intent,'upload-local');transfers++;ordersOwner='account';return {mainRevision:1,sharedRevision:1}},
      prepareCloudState:()=>({}),model:{state:{}},checksSession:{},render:()=>{},startPolling:()=>{},startFinanceAutoSync:()=>{}});
    await orders.enableCloud();
    const kupa=createKupaUiCloud({session:{cloudDocumentName:'main'},tab:{primaryTab:true},supaConfigured:()=>true,
      restoreSupaSession:async()=>({user:{id:'account'}}),loadSupaSession:()=>({user:{id:'account'}}),setCloudHeaderStatus:()=>{},getCloudPending:async()=>null,
      storageV2PrimaryRequested:()=>true,refreshStorageV2CloudState:async()=>null,supaEnsureSession:async()=>{},
      readSupabaseDocument:async()=>null,persistSupabaseState:async()=>{writes++},friendlySupabaseError:error=>error.message,
      isSupabaseAuthError:()=>false,storageOwnerCurrent:()=>kupaOwner,
      startStorageV2OwnerTransfer:async({targetOwner,intent})=>{assert.equal(targetOwner,'account');assert.equal(intent,'upload-local');transfers++;kupaOwner='account';return {mainRevision:1,sharedRevision:1}},
      model:{state:{}},checksSession:{},prepareKupaCloudState:()=>({}),setConnectedStatus:()=>{},render:()=>{},startCloudPolling:()=>{}});
    await kupa.enableCloudFromCurrentState();
    assert.equal(writes,0);assert.equal(transfers,2);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;if(priorAlert===undefined)delete globalThis.alert;else globalThis.alert=priorAlert;if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument}
});

test('V2 logout clears authorization without moving visible account data into the local owner',()=>{
  const prior=globalThis.localStorage,priorDocument=globalThis.document;globalThis.localStorage=localStore();
  globalThis.document={getElementById:()=>({style:{}})};
  try{
    let ordersSessionWrites=0,kupaSessionWrites=0;
    const ordersSession={cloudRecoveryTimer:null,cloudPollTimer:null},ordersChecks={};
    const orders=createOrdersUiCloud({session:ordersSession,checksSession:ordersChecks,storageV2PrimaryRequested:()=>true,saveSession:value=>{assert.equal(value,null);ordersSessionWrites++},toast:()=>{},setCloud:()=>{},renderSettings:()=>{}});
    const kupaSession={cloudRecoveryTimer:null,cloudPollTimer:null,serverInfo:{}},kupaChecks={};
    const kupa=createKupaUiCloud({session:kupaSession,checksSession:kupaChecks,storageV2PrimaryRequested:()=>true,tab:{primaryTab:true},storeSupaSession:value=>{assert.equal(value,null);kupaSessionWrites++},toast:()=>{},setCloudHeaderStatus:()=>{},showFirstRun:()=>{}});
    assert.equal(orders.logoutCloud(),true);
    assert.equal(kupa.logoutSupabase(),true);
    assert.equal(ordersSessionWrites,1);
    assert.equal(kupaSessionWrites,1);
    assert.equal(globalThis.localStorage.length,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument}
});

for(const app of ['orders','kupa'])test(`${app}: primary rejects Shared Checks V1 base and outbox writes`,async()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();let writes=0;
  try{
    const model={state:{checks:[{id:'C',amount:100}]}},checksSession={},idbPut=async()=>{writes++},idbDelete=async()=>{writes++};
    const storage=app==='orders'
      ?createStorageChecks({model,checksSession,idbPut,idbDelete,idbGet:async()=>null,legacyWriteAllowed:()=>false})
      :createSyncChecksState({model,checksSession,session:{},idbPut,idbDelete,idbGet:async()=>null,legacyWriteAllowed:()=>false});
    assert.throws(()=>app==='orders'?storage.persistChecksBase(model.state.checks):storage.persistSharedChecksBase(model.state.checks),/write_forbidden/);
    assert.throws(()=>app==='orders'?storage.markChecksPending(model.state.checks):storage.markSharedChecksPending(model.state.checks),/write_forbidden/);
    await assert.rejects(app==='orders'?storage.clearChecksPending(1):storage.clearSharedChecksPending(1),/write_forbidden/);
    assert.equal(app==='orders'?await storage.getChecksPending():await storage.getSharedChecksPending(),null);
    assert.equal(globalThis.localStorage.length,0);assert.equal(writes,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('cutover marker fails closed on missing Main checkpoint and forbids Orders V1 outbox',async()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();
  try{
    const browser=createOrdersBrowser({storageV2:{cutoverActive:true,recover:async()=>null,persist:()=>({handled:false})},model:{state:{}},files:{},session:{localSnapshotSeq:0,cloudRevision:0},prepareState:()=>({}),prepareCloudState:()=>({}),normalizeState:value=>value});
    await assert.rejects(browser.restoreBrowserStateFallback(),/cutover_recovery_required/);
    assert.throws(()=>browser.markCloudPending(),/write_forbidden/);
    assert.equal(globalThis.localStorage.length,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('cutover marker forbids Kupa V1 browser snapshots and cloud outboxes',async()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();let writes=0;
  try{
    const browser=createKupaBrowser({storageV2:{cutoverActive:true,recover:async()=>null,persist:()=>({handled:false})},model:{state:{}},session:{localSnapshotSeq:0,dbRevision:0},files:{},normalizeState:value=>value,idbGet:async()=>null,idbPut:async()=>{writes++}});
    assert.throws(()=>browser.persistImmediateBrowserSnapshot(),/write_forbidden/);
    await assert.rejects(browser.loadBrowserState(),/cutover_recovery_required/);
    const pending=createStoragePending({session:{},idbGet:async()=>null,idbPut:async()=>{writes++},idbDelete:async()=>{writes++},legacyWriteAllowed:()=>false});
    await assert.rejects(pending.putCloudPending({snapshot:{}}),/write_forbidden/);
    assert.equal(globalThis.localStorage.length,0);assert.equal(writes,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('durable cutover marker must agree with its synchronous cache and requires clean legacy heads',async()=>{
  const storage=localStore(),records=new Map();let marks=0,owner='account-A';
  const db={readCutover:async scope=>records.get(scope)||null,markCutover:async(app,identity)=>{marks++;const record={version:2,scope:`${app}:${identity}`,app,owner:identity};records.set(record.scope,record);return record}};
  const cutover=createStorageV2Cutover({app:'orders',owner:()=>owner,primary:()=>true,db,storage});
  assert.equal(await cutover.verify(),false);
  await assert.rejects(cutover.mark({verifyLegacyClean:async()=>false}),/legacy_pending/);
  assert.equal(marks,0);
  await cutover.mark({verifyLegacyClean:async()=>true});
  assert.equal(await cutover.verify(),true);
  storage.removeItem(storageCutoverKey('orders',owner));
  assert.equal(await cutover.verify(),true);
  assert.equal(storage.getItem(storageCutoverKey('orders',owner)),'2');
  records.delete(`orders:${owner}`);
  await assert.rejects(cutover.verify(),/marker_mismatch/);
  owner='account-B';
  assert.equal(await cutover.verify(),false);
});

for(const marker of ['cloud','local'])test(`Orders secondary tab recovers Main and Shared read-only before render after ${marker} V2 marker`,async()=>{
  const previous=globalThis.localStorage;globalThis.localStorage=localStore();
  try{
    const calls=[],model={state:{checks:[{id:'obsolete'}]}};
    const lifecycle=createOrdersLifecycle({model,tab:{primaryTab:false},verifyStorageCutover:async()=>marker==='cloud',verifyLocalStorageEngine:async()=>marker==='local',
      storageOwnerCurrent:()=>marker==='local'?'local':'account',
      acquirePrimaryTabLock:async()=>{},loadSession:()=>null,
      restoreBrowserStateFallback:async()=>{throw new Error('secondary used legacy Main recovery')},
      restoreBrowserStateReadOnly:async()=>{throw new Error('V2 secondary used legacy read-only recovery')},
      recoverReadOnlyV2State:async()=>{calls.push('main-readonly');return {source:'v2-readonly'}},
      recoverSharedChecksV2ReadOnly:async()=>{calls.push('shared-readonly');model.state.checks=[];return {seq:1}},
      recoverSharedChecksV2Primary:async()=>{throw new Error('secondary acquired Shared Checks writer')},
      render:()=>{assert.deepEqual(model.state.checks,[]);calls.push('render')},showSecondaryTabGuard:()=>calls.push('guard'),
      syncFolderAccessButton:()=>calls.push('folder')});
    await lifecycle.boot();
    assert.deepEqual(calls,['main-readonly','shared-readonly','render','guard','folder']);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
});

test('Kupa V2 startup holds Main recovery off screen until Shared hydration',async()=>{
  const calls=[],model={state:{checks:[]}},session={},checksSession={sharedChecksGeneration:0};
  const recovery=createSyncRecovery({model,session,checksSession,
    loadBrowserState:async()=>({state:{checks:[{id:'stale'}],cash:[]},revision:2}),
    getCloudPending:async()=>null,getSharedChecksPending:async()=>null,
    refreshStorageV2CloudState:async()=>({base:{revision:2,state:{checks:[],cash:[]}}}),
    normalizeState:value=>value,prepareKupaCloudState:value=>value,applyKupaCloudState:value=>value,
    hideConnectScreen:()=>{},setSaveStatus:()=>{},setConnectedStatus:()=>{},setCloudHeaderStatus:()=>{},
    loadSharedChecksBase:()=>[],sharedChecksPendingExists:()=>false,startCloudPolling:()=>{},render:()=>calls.push('render')});
  assert.equal(await recovery.openBrowserStateFallback({startup:true,deferRender:true}),true);
  assert.deepEqual(calls,[]);assert.equal(model.state.checks[0].id,'stale');
});

test('Kupa blocks ordinary cloud-open paths while a Storage V2 cutover is preparing',async()=>{
  const priorNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),priorAlert=globalThis.alert;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  let reads=0,sharedPulls=0,alerts=0;
  globalThis.alert=()=>{alerts++};
  try{
    const cloud=createKupaUiCloud({session:{},tab:{primaryTab:true},checksSession:{},model:{state:{}},supaConfigured:()=>true,
      restoreSupaSession:async()=>({user:{id:'account-A'}}),storageTransitionPreparing:()=>true,setCloudHeaderStatus:()=>{},
      readSupabaseDocument:async()=>{reads++;return {revision:1,state:{}}},syncSharedChecksFromCloud:async()=>{sharedPulls++;return true},
      openBrowserStateFallback:async()=>false,isSupabaseAuthError:()=>false,friendlySupabaseError:error=>error.message});
    assert.equal(await cloud.openCloudUsingSavedSession({interactive:true}),false);
    assert.equal(await cloud.tryAutoOpenSupabase(),false);
    assert.equal(reads,0);assert.equal(sharedPulls,0);assert.equal(alerts,1);
  }finally{if(priorNavigator)Object.defineProperty(globalThis,'navigator',priorNavigator);else delete globalThis.navigator;if(priorAlert===undefined)delete globalThis.alert;else globalThis.alert=priorAlert}
});

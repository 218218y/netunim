import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageChecks} from '../netunim-orders/site/assets/js/storage/checks.js';
import {createSyncChecksState} from '../netunim-kupa/site/assets/js/sync/checks-state.js';
import {createStorageBrowser as createOrdersBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';
import {createStorageBrowser as createKupaBrowser} from '../netunim-kupa/site/assets/js/storage/browser.js';
import {INITIAL_STATE as ORDERS_INITIAL_STATE,STORAGE_KEY as ORDERS_LEGACY_SNAPSHOT_KEY} from '../netunim-orders/site/assets/js/state/constants.js';
import {BROWSER_STATE_KEY as KUPA_LEGACY_SNAPSHOT_KEY} from '../netunim-kupa/site/assets/js/state/constants.js';
import {createStoragePending} from '../netunim-kupa/site/assets/js/storage/pending.js';
import {createStorageV2Cutover,storageCutoverKey} from '../shared/storage-v2-cutover.js';
import {createLifecycle as createOrdersLifecycle} from '../netunim-orders/site/assets/js/lifecycle.js';
import {createSyncRecovery} from '../netunim-kupa/site/assets/js/sync/recovery.js';
import {createUiCloud as createOrdersUiCloud} from '../netunim-orders/site/assets/js/ui/cloud.js';
import {createUiCloud as createKupaUiCloud} from '../netunim-kupa/site/assets/js/ui/cloud.js';
import {createOrdersStorageV2Coordinator} from '../netunim-orders/site/assets/js/composition/storage-v2.js';
import {createKupaStorageV2Coordinator} from '../netunim-kupa/site/assets/js/composition/storage-v2.js';

function localStore(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),get length(){return values.size},key:index=>[...values.keys()][index]??null}}

test('an unmarked browser cannot use ordinary V1 writers before local birth or account verification',()=>{
  for(const create of [createOrdersStorageV2Coordinator,createKupaStorageV2Coordinator]){
    const coordinator=create({tab:{primaryTab:true},session:{storageProtocolBlocked:false},storage:localStore()});
    coordinator.owner.current=()=> 'local';
    Object.defineProperty(coordinator.owner,'writable',{get:()=>true});
    assert.equal(coordinator.legacyWriteAllowed(),false);
    assert.equal(coordinator.legacyChecksWriteAllowed(),false);
    assert.equal(coordinator.pendingLegacyWriteAllowed({cutoverActive:false}),false);
  }
});

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
    await assert.rejects(browser.restoreBrowserStateFallback(),/v2_main_recovery_required/);
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

test('Kupa V2 save bypasses the retired V1 writer while protocol verification still gates all saves',()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();let v2Writes=0;
  try{
    const session={localSnapshotSeq:0,dbRevision:0,storageProtocolBlocked:false};
    const browser=createKupaBrowser({storageV2:{cutoverActive:true,persist:()=>{v2Writes++;return {handled:true,committed:Promise.resolve(),emergencyDurable:true}}},
      model:{state:{}},session,files:{},legacyWriteAllowed:()=>false});
    assert.equal(browser.persistImmediateBrowserSnapshot(),true);
    assert.equal(v2Writes,1);assert.equal(globalThis.localStorage.length,0);
    session.storageProtocolBlocked=true;
    assert.throws(()=>browser.persistImmediateBrowserSnapshot(),/storage_protocol_verification_required/);
    assert.equal(v2Writes,1);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('Orders cutover startup restores Main V2 without opening a legacy browser snapshot',async()=>{
  const previous=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>{throw new Error('legacy_snapshot_read')}};
  try{
    const state=structuredClone(ORDERS_INITIAL_STATE),model={state:{}};
    const browser=createOrdersBrowser({storageV2:{cutoverActive:true,recover:async()=>({state,appMetadata:{snapshotSeq:11}})},
      model,files:{},session:{localSnapshotSeq:0,cloudRevision:3},normalizeState:value=>structuredClone(value),
      domainRevisions:{reconcile:()=>{}},captureLegacyWorkbook:async()=>{}});
    assert.equal(await browser.restoreBrowserStateFallback(),true);
    assert.deepEqual(model.state,state);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
});

test('Kupa cutover startup reads only V2 Main and cloud cursor before Shared hydration',async()=>{
  const priorStorage=globalThis.localStorage,priorNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  globalThis.localStorage={getItem:()=>{throw new Error('legacy_snapshot_read')}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});
  try{
    const model={state:{}},session={localSnapshotSeq:0},checksSession={sharedChecksGeneration:0};
    const browser=createKupaBrowser({storageV2:{cutoverActive:true,recover:async()=>({state:{cash:[{id:'v2'}],checks:[]},appMetadata:{snapshotSeq:9,revision:4}})},
      model,session,files:{},idbGet:async()=>{throw new Error('legacy_idb_read')}});
    const recovery=createSyncRecovery({model,session,checksSession,loadBrowserState:browser.loadBrowserState,
      getCloudPending:async()=>{throw new Error('legacy_main_pending_read')},getSharedChecksPending:async()=>{throw new Error('legacy_shared_pending_read')},
      loadSharedChecksBase:()=>{throw new Error('legacy_checks_base_read')},loadSharedChecksBankEvents:()=>{throw new Error('legacy_events_read')},
      sharedChecksPendingExists:()=>{throw new Error('legacy_checks_pending_read')},
      refreshStorageV2CloudState:async()=>({base:{revision:4,state:{cash:[{id:'v2'}]}},pending:false,flight:null}),
      normalizeState:value=>structuredClone(value),prepareKupaCloudState:value=>structuredClone(value),
      hideConnectScreen:()=>{},setConnectedStatus:()=>{},setSaveStatus:()=>{},setCloudHeaderStatus:()=>{},render:()=>{},startCloudPolling:()=>{}});
    assert.equal(await recovery.openBrowserStateFallback({startup:true,deferRender:true}),true);
    assert.deepEqual(model.state.cash,[{id:'v2'}]);assert.equal(session.dbRevision,4);assert.equal(session.localSnapshotSeq,9);
  }finally{if(priorStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=priorStorage;if(priorNavigator)Object.defineProperty(globalThis,'navigator',priorNavigator);else delete globalThis.navigator}
});

test('secondary V2 recovery does not consult legacy snapshots or pending state',async()=>{
  const prior=globalThis.localStorage;globalThis.localStorage={getItem:()=>{throw new Error('legacy_snapshot_read')}};
  try{
    const ordersModel={state:{}};
    const orders=createOrdersBrowser({storageV2:{cutoverActive:true,recoverReadOnly:async()=>({state:structuredClone(ORDERS_INITIAL_STATE),appMetadata:{snapshotSeq:5}})},
      model:ordersModel,files:{},session:{localSnapshotSeq:0},normalizeState:value=>structuredClone(value)});
    assert.equal(await orders.restoreBrowserStateReadOnly(),true);
    assert.deepEqual(ordersModel.state.checks,[]);
    const model={state:{}},session={},checksSession={};
    const kupa=createKupaBrowser({storageV2:{cutoverActive:true,recoverReadOnly:async()=>({state:{cash:[{id:'v2'}],checks:[]},appMetadata:{snapshotSeq:6,revision:7}})},
      model,session,files:{},idbGet:async()=>{throw new Error('legacy_idb_read')}});
    const recovery=createSyncRecovery({model,session,checksSession,loadBrowserStateReadOnly:kupa.loadBrowserStateReadOnly,
      getCloudPending:async()=>{throw new Error('legacy_main_pending_read')},getSharedChecksPending:async()=>{throw new Error('legacy_shared_pending_read')},
      loadSharedChecksBase:()=>{throw new Error('legacy_checks_base_read')},loadSharedChecksBankEvents:()=>{throw new Error('legacy_events_read')},
      normalizeState:value=>structuredClone(value),hideConnectScreen:()=>{},setConnectedStatus:()=>{},setSaveStatus:()=>{},setCloudHeaderStatus:()=>{},render:()=>{}});
    assert.equal(await recovery.openBrowserStateReadOnly(),true);
    assert.deepEqual(model.state.cash,[{id:'v2'}]);assert.equal(session.dbRevision,7);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

for(const app of ['orders','kupa'])test(`${app}: V2 save never parses the legacy full snapshot`,()=>{
  const prior=globalThis.localStorage,legacyKey=app==='orders'?ORDERS_LEGACY_SNAPSHOT_KEY:KUPA_LEGACY_SNAPSHOT_KEY;
  const storage=localStore();let v2Writes=0;
  globalThis.localStorage={...storage,getItem:key=>{if(key===legacyKey)throw new Error('legacy_snapshot_read');return storage.getItem(key)}};
  try{
    const storageV2={cutoverActive:true,persist:()=>{v2Writes++;return {handled:true,committed:Promise.resolve(),emergencyDurable:true}}};
    const session={localSnapshotSeq:7,cloudRevision:1,dbRevision:1,storageProtocolBlocked:false};
    const browser=app==='orders'
      ?createOrdersBrowser({storageV2,model:{state:structuredClone(ORDERS_INITIAL_STATE)},files:{},session,legacyWriteAllowed:()=>false})
      :createKupaBrowser({storageV2,model:{state:{}},files:{},session,legacyWriteAllowed:()=>false});
    const result=app==='orders'?browser.localSnapshot():browser.persistImmediateBrowserSnapshot();
    assert.equal(result,true);assert.equal(v2Writes,1);assert.equal(storage.length,0);
    session.storageProtocolBlocked=true;
    assert.throws(()=>app==='orders'?browser.localSnapshot():browser.persistImmediateBrowserSnapshot(),/storage_protocol_verification_required/);
    assert.equal(v2Writes,1);
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
    const lifecycle=createOrdersLifecycle({model,session:{},tab:{primaryTab:false},verifyStorageCutover:async()=>marker==='cloud',verifyLocalStorageEngine:async()=>marker==='local',
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

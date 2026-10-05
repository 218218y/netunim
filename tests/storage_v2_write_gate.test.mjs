import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncChecksState} from '../netunim-kupa/site/assets/js/sync/checks-state.js';
import {createSyncChecksPersistence} from '../netunim-orders/site/assets/js/sync/checks-persistence.js';
import {createStoragePersistence as createKupaPersistence} from '../netunim-kupa/site/assets/js/storage/persistence.js';
import {createStorageBrowser as createOrdersBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';
import {createStoragePersistence as createOrdersPersistence} from '../netunim-orders/site/assets/js/storage/persistence.js';
import {createStorageBrowser as createKupaBrowser} from '../netunim-kupa/site/assets/js/storage/browser.js';
import {INITIAL_STATE as ORDERS_INITIAL_STATE} from '../netunim-orders/site/assets/js/state/constants.js';
import {ORDERS_LEGACY_SNAPSHOT_KEY,KUPA_LEGACY_SNAPSHOT_KEY} from './retired_business_storage_keys.mjs';
import {createStorageV2Cutover,storageCutoverKey} from '../shared/storage-v2-cutover.js';
import {createLifecycle as createOrdersLifecycle} from '../netunim-orders/site/assets/js/lifecycle.js';
import {createSyncRecovery} from '../netunim-kupa/site/assets/js/sync/recovery.js';
import {createUiCloud as createOrdersUiCloud} from '../netunim-orders/site/assets/js/ui/cloud.js';
import {createUiCloud as createKupaUiCloud} from '../netunim-kupa/site/assets/js/ui/cloud.js';
import {createOrdersStorageV2Coordinator} from '../netunim-orders/site/assets/js/composition/storage-v2.js';
import {createKupaStorageV2Coordinator} from '../netunim-kupa/site/assets/js/composition/storage-v2.js';

function localStore(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),get length(){return values.size},key:index=>[...values.keys()][index]??null}}

test('Orders rejected secondary edit reloads V2 instead of reading a V1 snapshot',()=>{
  const previousLocation=Object.getOwnPropertyDescriptor(globalThis,'location');
  const previousStorage=globalThis.localStorage;
  let guardCalls=0,reloads=0;
  Object.defineProperty(globalThis,'location',{configurable:true,value:{reload:()=>{reloads++}}});
  globalThis.localStorage={getItem:()=>{throw new Error('V1 snapshot read')}};
  try{
    const persistence=createOrdersPersistence({model:{state:{}},tab:{primaryTab:false},session:{},
      showSecondaryTabGuard:()=>{guardCalls++}});
    assert.equal(persistence.rejectSecondaryMutation(),true);
    assert.equal(guardCalls,1);assert.equal(reloads,1);
  }finally{
    if(previousLocation)Object.defineProperty(globalThis,'location',previousLocation);else delete globalThis.location;
    if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage;
  }
});

test('ordinary startup cannot enable V1 writers in an unmarked browser',()=>{
  for(const create of [createOrdersStorageV2Coordinator,createKupaStorageV2Coordinator]){
    const coordinator=create({tab:{primaryTab:true},session:{storageProtocolBlocked:false},storage:localStore()});
    coordinator.owner.current=()=> 'local';
    Object.defineProperty(coordinator.owner,'writable',{get:()=>true});
    assert.equal('legacyWriteAllowed' in coordinator,false);
    assert.equal('legacyChecksWriteAllowed' in coordinator,false);
    assert.equal('pendingLegacyWriteAllowed' in coordinator,false);
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

test('Kupa Shared Checks state exposes only V2-backed live state helpers',()=>{
  const storage=createSyncChecksState({model:{state:{checks:[]}},checksSession:{},session:{},normalizeState:value=>value,sharedChecksHasLocalWork:()=>false});
  assert.deepEqual(Object.keys(storage).sort(),['lastSavedState','sharedChecksHaveLocalWork']);
  assert.equal(storage.sharedChecksHaveLocalWork(),false);
});

test('check edits without a ready Shared V2 runtime fail before any legacy write',async()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();
  try{
    const ordersSession={localGeneration:0},ordersStatus=[];
    const orders=createSyncChecksPersistence({session:ordersSession,checksSession:{},sharedChecksV2:null,
      rejectSecondaryMutation:()=>false,touchChecksRevision:()=>{},refreshAlertCenter:()=>{},
      setSave:value=>ordersStatus.push(value),folderSaveTitle:()=>''});
    assert.equal(orders.scheduleCheckSave('edit'),false);
    assert.equal(ordersSession.localUndurableGenerations.size,1);
    const kupaSession={},kupaStatus=[];
    const kupa=createKupaPersistence({session:kupaSession,checksSession:{},tab:{primaryTab:true},sharedChecksV2:null,
      setSaveStatus:value=>kupaStatus.push(value)});
    assert.equal(await kupa.saveChecksState('edit'),false);
    assert.equal(kupaSession.localUndurableGenerations.size,1);
    assert.ok(ordersStatus.length&&kupaStatus.length);
    assert.equal(globalThis.localStorage.length,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('Orders V2 fails closed on missing Main checkpoint and exposes no V1 outbox writer',async()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();
  try{
    const browser=createOrdersBrowser({storageV2:{cutoverActive:true,recover:async()=>null,persist:()=>({handled:false})},model:{state:{}},files:{},session:{localSnapshotSeq:0,cloudRevision:0},prepareState:()=>({}),prepareCloudState:()=>({}),normalizeState:value=>value});
    await assert.rejects(browser.recoverLocalV2State(),/v2_main_recovery_required/);
    assert.equal(browser.markCloudPending,undefined);
    await assert.rejects(browser.idbSyncPut('orders-outbox-v3',{}),/storage_v1_write_forbidden/);
    await assert.rejects(browser.idbSyncPut('shared-checks-outbox-v3',{}),/storage_v1_write_forbidden/);
    await assert.rejects(browser.idbSyncGet('orders-outbox-v3'),/storage_restore_group_key_required/);
    await assert.rejects(browser.idbSyncDelete('shared-checks-outbox-v3'),/storage_restore_group_key_required/);
    assert.equal(globalThis.localStorage.length,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('cutover marker forbids Kupa V1 browser snapshots and cloud outboxes',async()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();let writes=0;
  try{
    const browser=createKupaBrowser({storageV2:{cutoverActive:true,recover:async()=>null,persist:()=>({handled:false})},model:{state:{}},session:{localSnapshotSeq:0,dbRevision:0},files:{},normalizeState:value=>value,idbGet:async()=>null,idbPut:async()=>{writes++}});
    assert.throws(()=>browser.persistImmediateBrowserSnapshot(),/storage_v2_write_unavailable/);
    await assert.rejects(browser.loadBrowserState(),/v2_main_recovery_required/);
    assert.equal(globalThis.localStorage.length,0);assert.equal(writes,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('Kupa V2 save bypasses the retired V1 writer while protocol verification still gates all saves',()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();let v2Writes=0;
  try{
    const session={localSnapshotSeq:0,dbRevision:0,storageProtocolBlocked:false};
    const browser=createKupaBrowser({storageV2:{cutoverActive:true,persist:()=>{v2Writes++;return {handled:true,committed:Promise.resolve(),emergencyDurable:true}}},
      model:{state:{}},session,files:{}});
    assert.equal(browser.persistImmediateBrowserSnapshot(),true);
    assert.equal(v2Writes,1);assert.equal(globalThis.localStorage.length,0);
    session.storageProtocolBlocked=true;
    assert.throws(()=>browser.persistImmediateBrowserSnapshot(),/storage_protocol_verification_required/);
    assert.equal(v2Writes,1);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('unmarked Kupa browser cannot recover a V1 business snapshot',async()=>{
  const previous=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>{throw new Error('legacy_snapshot_read')}};
  try{
    const browser=createKupaBrowser({storageV2:{cutoverActive:false,recover:async()=>null,recoverReadOnly:async()=>null},
      model:{state:{}},session:{localSnapshotSeq:0},files:{},idbGet:async()=>{throw new Error('legacy_idb_read')}});
    assert.equal(await browser.loadBrowserState(),null);
    assert.equal(await browser.loadBrowserStateReadOnly(),null);
    const recovery=createSyncRecovery({model:{state:{}},session:{},loadBrowserState:browser.loadBrowserState});
    assert.equal(await recovery.openBrowserStateFallback(),false);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
});

test('Orders cutover startup restores Main V2 without opening a legacy browser snapshot',async()=>{
  const previous=globalThis.localStorage;
  globalThis.localStorage={getItem:()=>{throw new Error('legacy_snapshot_read')}};
  try{
    const state=structuredClone(ORDERS_INITIAL_STATE),model={state:{}},captured=[];
    state.notesSheet={sheets:[{id:'historical'}],columns:[],rows:[]};
    const browser=createOrdersBrowser({storageV2:{cutoverActive:true,recover:async()=>({state,appMetadata:{snapshotSeq:11}})},
      model,files:{},session:{localSnapshotSeq:0,cloudRevision:3},normalizeState:value=>structuredClone(value),
      domainRevisions:{reconcile:()=>{}},captureEmbeddedWorkbook:async sheet=>captured.push(sheet)});
    assert.ok(await browser.recoverLocalV2State());
    assert.deepEqual(model.state,state);
    assert.deepEqual(captured,[state.notesSheet]);
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
    assert.ok(await orders.recoverReadOnlyV2State());
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
      ?createOrdersBrowser({storageV2,model:{state:structuredClone(ORDERS_INITIAL_STATE)},files:{},session})
      :createKupaBrowser({storageV2,model:{state:{}},files:{},session});
    const result=app==='orders'?browser.localSnapshot():browser.persistImmediateBrowserSnapshot();
    assert.equal(result,true);assert.equal(v2Writes,1);assert.equal(storage.length,0);
    session.storageProtocolBlocked=true;
    assert.throws(()=>app==='orders'?browser.localSnapshot():browser.persistImmediateBrowserSnapshot(),/storage_protocol_verification_required/);
    assert.equal(v2Writes,1);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('durable cutover marker must agree with its synchronous cache and require a primary V2 writer',async()=>{
  const storage=localStore(),records=new Map();let marks=0,owner='account-A';
  const db={readCutover:async scope=>records.get(scope)||null,markCutover:async(app,identity)=>{marks++;const record={version:2,scope:`${app}:${identity}`,app,owner:identity};records.set(record.scope,record);return record}};
  const cutover=createStorageV2Cutover({app:'orders',owner:()=>owner,primary:()=>true,db,storage});
  assert.equal(await cutover.verify(),false);
  const secondary=createStorageV2Cutover({app:'orders',owner:()=>owner,primary:()=>false,db,storage});
  await assert.rejects(secondary.mark(),/preflight_required/);
  assert.equal(marks,0);
  await cutover.mark();
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
    loadBrowserState:async()=>({v2Authoritative:true,state:{cash:[]},revision:2}),
    getCloudPending:async()=>null,getSharedChecksPending:async()=>null,
    refreshStorageV2CloudState:async()=>({base:{revision:2,state:{checks:[],cash:[]}}}),
    normalizeState:value=>value,prepareKupaCloudState:value=>value,applyKupaCloudState:value=>value,
    hideConnectScreen:()=>{},setSaveStatus:()=>{},setConnectedStatus:()=>{},setCloudHeaderStatus:()=>{},
    loadSharedChecksBase:()=>[],sharedChecksPendingExists:()=>false,startCloudPolling:()=>{},render:()=>calls.push('render')});
  assert.equal(await recovery.openBrowserStateFallback({startup:true,deferRender:true}),true);
  assert.deepEqual(calls,[]);assert.deepEqual(model.state.checks,[]);
});

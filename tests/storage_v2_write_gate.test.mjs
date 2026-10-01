import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSyncChecksState} from '../netunim-kupa/site/assets/js/sync/checks-state.js';
import {createSyncChecksPersistence} from '../netunim-orders/site/assets/js/sync/checks-persistence.js';
import {createStoragePersistence as createKupaPersistence} from '../netunim-kupa/site/assets/js/storage/persistence.js';
import {createStorageBrowser as createOrdersBrowser} from '../netunim-orders/site/assets/js/storage/browser.js';
import {createStoragePersistence as createOrdersPersistence} from '../netunim-orders/site/assets/js/storage/persistence.js';
import {createStorageBrowser as createKupaBrowser} from '../netunim-kupa/site/assets/js/storage/browser.js';
import {INITIAL_STATE as ORDERS_INITIAL_STATE} from '../netunim-orders/site/assets/js/state/constants.js';
import {createStorageV2Cutover,storageCutoverKey} from '../shared/storage-v2-cutover.js';
import {createLifecycle as createOrdersLifecycle} from '../netunim-orders/site/assets/js/lifecycle.js';
import {createSyncRecovery} from '../netunim-kupa/site/assets/js/sync/recovery.js';
import {createUiCloud as createOrdersUiCloud} from '../netunim-orders/site/assets/js/ui/cloud.js';
import {createUiCloud as createKupaUiCloud} from '../netunim-kupa/site/assets/js/ui/cloud.js';
import {createOrdersStorageV2Coordinator} from '../netunim-orders/site/assets/js/composition/storage-v2.js';
import {createKupaStorageV2Coordinator} from '../netunim-kupa/site/assets/js/composition/storage-v2.js';

function localStore(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),get length(){return values.size},key:index=>[...values.keys()][index]??null}}

const deletedRuntimeModules=[
  new URL('../netunim-orders/site/assets/js/storage/checks.js',import.meta.url),
  new URL('../netunim-kupa/site/assets/js/storage/pending.js',import.meta.url),
  new URL('../netunim-kupa/site/assets/js/sync/pending.js',import.meta.url),
];

test('Orders rejected secondary edit reloads V2 instead of reading a retired browser snapshot',()=>{
  const previousLocation=Object.getOwnPropertyDescriptor(globalThis,'location'),previousStorage=globalThis.localStorage;let guardCalls=0,reloads=0;
  Object.defineProperty(globalThis,'location',{configurable:true,value:{reload:()=>{reloads++}}});
  globalThis.localStorage={getItem:()=>{throw new Error('retired_snapshot_read')}};
  try{
    const persistence=createOrdersPersistence({model:{state:{}},tab:{primaryTab:false},session:{},showSecondaryTabGuard:()=>{guardCalls++}});
    assert.equal(persistence.rejectSecondaryMutation(),true);assert.equal(guardCalls,1);assert.equal(reloads,1);
  }finally{if(previousLocation)Object.defineProperty(globalThis,'location',previousLocation);else delete globalThis.location;if(previousStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=previousStorage}
});

test('storage coordinators expose no V1 writer switches',()=>{
  for(const create of [createOrdersStorageV2Coordinator,createKupaStorageV2Coordinator]){
    const coordinator=create({tab:{primaryTab:true},session:{storageProtocolBlocked:false},storage:localStore()});
    for(const name of ['legacyWriteAllowed','pendingLegacyWriteAllowed','legacyChecksWriteAllowed'])assert.equal(name in coordinator,false,`${name} must not remain a runtime port`);
  }
});

test('retired Main/Shared outbox modules are absent from the production tree',()=>{
  for(const url of deletedRuntimeModules)assert.equal(fs.existsSync(url),false,url.pathname);
});

test('V2 owner handoff routes first-cloud UI through detached V2 transfer only',async()=>{
  const prior=globalThis.localStorage,priorAlert=globalThis.alert,priorDocument=globalThis.document;
  globalThis.localStorage=localStore();globalThis.alert=()=>{};globalThis.document={getElementById:()=>({style:{display:'flex'}})};
  let oldWriterCalls=0,transfers=0,ordersOwner='local',kupaOwner='local';
  try{
    const orders=createOrdersUiCloud({tab:{primaryTab:true},session:{},supaConfigured:()=>true,loadSession:()=>({user:{id:'account'}}),
      setCloud:()=>{},toast:()=>{},storageOwnerCurrent:()=>ordersOwner,storageV2PrimaryRequested:()=>true,
      requestCloudSave:async()=>{oldWriterCalls++},startStorageV2OwnerTransfer:async({targetOwner,intent})=>{assert.equal(targetOwner,'account');assert.equal(intent,'upload-local');transfers++;ordersOwner='account';return {mainRevision:1,sharedRevision:1}},
      prepareCloudState:()=>({}),model:{state:{}},checksSession:{},render:()=>{},startPolling:()=>{},startFinanceAutoSync:()=>{}});
    assert.equal(await orders.enableCloud(),true);
    const kupa=createKupaUiCloud({session:{cloudDocumentName:'main'},tab:{primaryTab:true},supaConfigured:()=>true,restoreSupaSession:async()=>({user:{id:'account'}}),loadSupaSession:()=>({user:{id:'account'}}),setCloudHeaderStatus:()=>{},storageV2PrimaryRequested:()=>true,supaEnsureSession:async()=>{},friendlySupabaseError:error=>error.message,isSupabaseAuthError:()=>false,storageOwnerCurrent:()=>kupaOwner,
      persistSupabaseState:async()=>{oldWriterCalls++},startStorageV2OwnerTransfer:async({targetOwner,intent})=>{assert.equal(targetOwner,'account');assert.equal(intent,'upload-local');transfers++;kupaOwner='account';return {mainRevision:1,sharedRevision:1}},
      model:{state:{}},checksSession:{},prepareKupaCloudState:()=>({}),setConnectedStatus:()=>{},render:()=>{},startCloudPolling:()=>{}});
    assert.equal(await kupa.enableCloudFromCurrentState(),true);
    assert.equal(oldWriterCalls,0);assert.equal(transfers,2);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;if(priorAlert===undefined)delete globalThis.alert;else globalThis.alert=priorAlert;if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument}
});

test('V2 logout clears authorization without moving visible account data into local owner',()=>{
  const prior=globalThis.localStorage,priorDocument=globalThis.document;globalThis.localStorage=localStore();globalThis.document={getElementById:()=>({style:{}})};
  try{
    let ordersSessionWrites=0,kupaSessionWrites=0;
    const orders=createOrdersUiCloud({session:{cloudRecoveryTimer:null,cloudPollTimer:null},checksSession:{},saveSession:value=>{assert.equal(value,null);ordersSessionWrites++},toast:()=>{},setCloud:()=>{},renderSettings:()=>{}});
    const kupa=createKupaUiCloud({session:{cloudRecoveryTimer:null,cloudPollTimer:null,serverInfo:{}},checksSession:{},tab:{primaryTab:true},storeSupaSession:value=>{assert.equal(value,null);kupaSessionWrites++},toast:()=>{},setCloudHeaderStatus:()=>{},showFirstRun:()=>{}});
    assert.equal(orders.logoutCloud(),true);assert.equal(kupa.logoutSupabase(),true);assert.equal(ordersSessionWrites,1);assert.equal(kupaSessionWrites,1);assert.equal(globalThis.localStorage.length,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument}
});

test('Kupa Shared Checks state helper is V2-only business state, not a persistence adapter',()=>{
  const api=createSyncChecksState({session:{lastSavedSnapshot:null},checksSession:{sharedChecksSaveRequested:false,sharedChecksBase:[]},model:{state:{checks:[]}},normalizeState:value=>value,prepareKupaCloudState:value=>value});
  assert.deepEqual(Object.keys(api).sort(),['lastSavedCloudState','lastSavedState','sharedChecksHaveLocalWork']);
  assert.equal(api.sharedChecksHaveLocalWork(),false);
});

test('check edits without a ready Shared V2 runtime fail before any fallback write',async()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();
  try{
    const ordersSession={localGeneration:0},ordersStatus=[];
    const orders=createSyncChecksPersistence({session:ordersSession,checksSession:{},sharedChecksV2:null,rejectSecondaryMutation:()=>false,touchChecksRevision:()=>{},refreshAlertCenter:()=>{},setSave:value=>ordersStatus.push(value),folderSaveTitle:()=>''});
    assert.equal(orders.scheduleCheckSave('edit'),false);assert.equal(ordersSession.localUndurableGenerations.size,1);
    const kupaSession={},kupaStatus=[];
    const kupa=createKupaPersistence({session:kupaSession,checksSession:{},tab:{primaryTab:true},sharedChecksV2:null,setSaveStatus:value=>kupaStatus.push(value)});
    assert.equal(await kupa.saveChecksState('edit'),false);assert.equal(kupaSession.localUndurableGenerations.size,1);assert.ok(ordersStatus.length&&kupaStatus.length);assert.equal(globalThis.localStorage.length,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('Orders cutover fails closed on missing Main V2 and rejects retired outbox record keys',async()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();
  try{
    const browser=createOrdersBrowser({storageV2:{cutoverActive:true,recover:async()=>null,persist:()=>({handled:false})},model:{state:{}},files:{},session:{localSnapshotSeq:0,cloudRevision:0},prepareCloudState:()=>({}),normalizeState:value=>value});
    await assert.rejects(browser.restoreBrowserStateFallback(),/v2_main_recovery_required/);
    await assert.rejects(browser.idbSyncPut('orders-outbox-v3',{}),/storage_v1_record_forbidden/);
    await assert.rejects(browser.idbSyncGet('shared-checks-outbox-v3'),/storage_v1_record_forbidden/);
    assert.equal(globalThis.localStorage.length,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('Kupa cutover fails closed when Main V2 is absent and has no V1 outbox API',async()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();let writes=0;
  try{
    const browser=createKupaBrowser({storageV2:{cutoverActive:true,recover:async()=>null,persist:()=>({handled:false})},model:{state:{}},session:{localSnapshotSeq:0,dbRevision:0},files:{},normalizeState:value=>value,idbPut:async()=>{writes++}});
    assert.throws(()=>browser.persistImmediateBrowserSnapshot(),/storage_v2_write_unavailable/);await assert.rejects(browser.loadBrowserState(),/cutover_recovery_required/);
    assert.equal('getCloudPending' in browser,false);assert.equal('putCloudPending' in browser,false);assert.equal(globalThis.localStorage.length,0);assert.equal(writes,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('Kupa V2 save is protocol-gated and never falls back to browser state',()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();let v2Writes=0;
  try{
    const session={localSnapshotSeq:0,dbRevision:0,storageProtocolBlocked:false};
    const browser=createKupaBrowser({storageV2:{cutoverActive:true,persist:()=>{v2Writes++;return {handled:true,committed:Promise.resolve(),emergencyDurable:true}}},model:{state:{}},session,files:{}});
    assert.equal(browser.persistImmediateBrowserSnapshot(),true);assert.equal(v2Writes,1);assert.equal(globalThis.localStorage.length,0);
    session.storageProtocolBlocked=true;assert.throws(()=>browser.persistImmediateBrowserSnapshot(),/storage_protocol_verification_required/);assert.equal(v2Writes,1);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('Orders cutover startup restores Main V2 without consulting LocalStorage business state',async()=>{
  const previous=globalThis.localStorage;globalThis.localStorage={getItem:()=>{throw new Error('retired_snapshot_read')}};
  try{
    const state=structuredClone(ORDERS_INITIAL_STATE),model={state:{}};
    const browser=createOrdersBrowser({storageV2:{cutoverActive:true,recover:async()=>({state,appMetadata:{snapshotSeq:11}})},model,files:{},session:{localSnapshotSeq:0,cloudRevision:3},normalizeState:value=>structuredClone(value),domainRevisions:{reconcile:()=>{}},captureLegacyWorkbook:async()=>{}});
    assert.equal(await browser.restoreBrowserStateFallback(),true);assert.deepEqual(model.state,state);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
});

test('Kupa cutover startup reads only V2 Main and cloud cursor before Shared hydration',async()=>{
  const priorStorage=globalThis.localStorage,priorNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');globalThis.localStorage={getItem:()=>{throw new Error('retired_snapshot_read')}};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:false}});
  try{
    const model={state:{}},session={localSnapshotSeq:0};
    const browser=createKupaBrowser({storageV2:{cutoverActive:true,recover:async()=>({state:{cash:[{id:'v2'}]},appMetadata:{snapshotSeq:9,revision:4}})},model,session,files:{}});
    const recovery=createSyncRecovery({model,session,loadBrowserState:browser.loadBrowserState,refreshStorageV2CloudState:async()=>({base:{revision:4,state:{cash:[{id:'v2'}]}},pending:false,flight:null,control:null}),normalizeState:value=>structuredClone(value),prepareKupaCloudState:value=>structuredClone(value),hideConnectScreen:()=>{},setConnectedStatus:()=>{},setSaveStatus:()=>{},setCloudHeaderStatus:()=>{},render:()=>{},startCloudPolling:()=>{}});
    assert.equal(await recovery.openBrowserStateFallback({startup:true,deferRender:true}),true);assert.deepEqual(model.state.cash,[{id:'v2'}]);assert.equal(session.dbRevision,4);assert.equal(session.localSnapshotSeq,9);
  }finally{if(priorStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=priorStorage;if(priorNavigator)Object.defineProperty(globalThis,'navigator',priorNavigator);else delete globalThis.navigator}
});

test('secondary V2 recovery uses read-only Main runtimes and no fallback business records',async()=>{
  const prior=globalThis.localStorage;globalThis.localStorage={getItem:()=>{throw new Error('retired_snapshot_read')}};
  try{
    const ordersModel={state:{}};const orders=createOrdersBrowser({storageV2:{cutoverActive:true,recoverReadOnly:async()=>({state:structuredClone(ORDERS_INITIAL_STATE),appMetadata:{snapshotSeq:5}})},model:ordersModel,files:{},session:{localSnapshotSeq:0},normalizeState:value=>structuredClone(value)});
    assert.equal(await orders.restoreBrowserStateReadOnly(),true);
    const model={state:{}},session={};const kupa=createKupaBrowser({storageV2:{cutoverActive:true,recoverReadOnly:async()=>({state:{cash:[{id:'v2'}]},appMetadata:{snapshotSeq:6,revision:7}})},model,session,files:{}});
    const recovery=createSyncRecovery({model,session,loadBrowserStateReadOnly:kupa.loadBrowserStateReadOnly,normalizeState:value=>structuredClone(value),hideConnectScreen:()=>{},setConnectedStatus:()=>{},setSaveStatus:()=>{},setCloudHeaderStatus:()=>{},render:()=>{}});
    assert.equal(await recovery.openBrowserStateReadOnly(),true);assert.deepEqual(model.state.cash,[{id:'v2'}]);assert.equal(session.dbRevision,7);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

for(const app of ['orders','kupa'])test(`${app}: V2 save never reads retired full-state LocalStorage keys`,()=>{
  const prior=globalThis.localStorage,retiredKey=app==='orders'?'orders.management.state.v1':'kupa.browser.state.v1',storage=localStore();let v2Writes=0;
  globalThis.localStorage={...storage,getItem:key=>{if(key===retiredKey)throw new Error('retired_snapshot_read');return storage.getItem(key)}};
  try{
    const storageV2={cutoverActive:true,persist:()=>{v2Writes++;return {handled:true,committed:Promise.resolve(),emergencyDurable:true}}},session={localSnapshotSeq:7,cloudRevision:1,dbRevision:1,storageProtocolBlocked:false};
    const browser=app==='orders'?createOrdersBrowser({storageV2,model:{state:structuredClone(ORDERS_INITIAL_STATE)},files:{},session,normalizeState:value=>value}):createKupaBrowser({storageV2,model:{state:{}},files:{},session});
    const result=app==='orders'?browser.localSnapshot():browser.persistImmediateBrowserSnapshot();assert.equal(result,true);assert.equal(v2Writes,1);assert.equal(storage.length,0);
    session.storageProtocolBlocked=true;assert.throws(()=>app==='orders'?browser.localSnapshot():browser.persistImmediateBrowserSnapshot(),/storage_protocol_verification_required/);assert.equal(v2Writes,1);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
});

test('durable V2 account marker agrees with its synchronous cache and needs no legacy-clean callback',async()=>{
  const storage=localStore(),records=new Map();let marks=0,owner='account-A';
  const db={readCutover:async scope=>records.get(scope)||null,markCutover:async(app,identity)=>{marks++;const record={version:2,scope:`${app}:${identity}`,app,owner:identity};records.set(record.scope,record);return record}};
  const cutover=createStorageV2Cutover({app:'orders',owner:()=>owner,primary:()=>true,db,storage});
  assert.equal(await cutover.verify(),false);await cutover.mark();assert.equal(marks,1);assert.equal(await cutover.verify(),true);
  storage.removeItem(storageCutoverKey('orders',owner));assert.equal(await cutover.verify(),true);assert.equal(storage.getItem(storageCutoverKey('orders',owner)),'2');
  records.delete(`orders:${owner}`);await assert.rejects(cutover.verify(),/marker_mismatch/);owner='account-B';assert.equal(await cutover.verify(),false);
});

for(const marker of ['cloud','local'])test(`Orders secondary tab recovers Main and Shared read-only before render after ${marker} V2 marker`,async()=>{
  const previous=globalThis.localStorage;globalThis.localStorage=localStore();
  try{
    const calls=[],model={state:{checks:[{id:'obsolete'}]}};
    const lifecycle=createOrdersLifecycle({model,session:{},tab:{primaryTab:false},verifyStorageCutover:async()=>marker==='cloud',verifyLocalStorageEngine:async()=>marker==='local',storageOwnerCurrent:()=>marker==='local'?'local':'account',acquirePrimaryTabLock:async()=>{},loadSession:()=>null,
      recoverReadOnlyV2State:async()=>{calls.push('main-readonly');return {source:'v2-readonly'}},recoverSharedChecksV2ReadOnly:async()=>{calls.push('shared-readonly');model.state.checks=[];return {seq:1}},recoverSharedChecksV2Primary:async()=>{throw new Error('secondary acquired Shared writer')},render:()=>{assert.deepEqual(model.state.checks,[]);calls.push('render')},showSecondaryTabGuard:()=>calls.push('guard'),syncFolderAccessButton:()=>calls.push('folder')});
    await lifecycle.boot();assert.deepEqual(calls,['main-readonly','shared-readonly','render','guard','folder']);
  }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous}
});

test('Kupa V2 startup holds Main recovery off screen until Shared hydration',async()=>{
  const calls=[],model={state:{cash:[]}},session={};
  const recovery=createSyncRecovery({model,session,loadBrowserState:async()=>({state:{cash:[{id:'main'}]},revision:2}),refreshStorageV2CloudState:async()=>({base:{revision:2,state:{cash:[]}},pending:false,flight:null,control:null}),normalizeState:value=>value,prepareKupaCloudState:value=>value,hideConnectScreen:()=>{},setSaveStatus:()=>{},setConnectedStatus:()=>{},setCloudHeaderStatus:()=>{},startCloudPolling:()=>{},render:()=>calls.push('render')});
  assert.equal(await recovery.openBrowserStateFallback({startup:true,deferRender:true}),true);assert.deepEqual(calls,[]);assert.equal(model.state.cash[0].id,'main');
});

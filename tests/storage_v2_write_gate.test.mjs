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

test('V2 owner handoff blocks both first-cloud UI paths before any V1 outbox write',async()=>{
  const prior=globalThis.localStorage,priorAlert=globalThis.alert;globalThis.localStorage=localStore();globalThis.alert=()=>{};
  let writes=0;
  try{
    const orders=createOrdersUiCloud({tab:{primaryTab:true},session:{},supaConfigured:()=>true,loadSession:()=>({user:{id:'account'}}),
      setCloud:()=>{},toast:()=>{},getCloudPending:async()=>null,readCloud:async()=>null,refreshStorageV2CloudState:async()=>null,
      storageV2PrimaryRequested:()=>true,markCloudPending:()=>{writes++},requestCloudSave:async()=>{writes++}});
    await orders.enableCloud();
    const kupa=createKupaUiCloud({session:{cloudDocumentName:'main'},tab:{primaryTab:true},supaConfigured:()=>true,
      restoreSupaSession:async()=>({user:{id:'account'}}),setCloudHeaderStatus:()=>{},getCloudPending:async()=>null,
      storageV2PrimaryRequested:()=>true,refreshStorageV2CloudState:async()=>null,supaEnsureSession:async()=>{},
      readSupabaseDocument:async()=>null,persistSupabaseState:async()=>{writes++},friendlySupabaseError:error=>error.message,
      isSupabaseAuthError:()=>false});
    await kupa.enableCloudFromCurrentState();
    assert.equal(writes,0);assert.equal(globalThis.localStorage.length,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior;if(priorAlert===undefined)delete globalThis.alert;else globalThis.alert=priorAlert}
});

test('V2 logout does not move visible account data into the local owner',()=>{
  const prior=globalThis.localStorage;globalThis.localStorage=localStore();
  try{
    let ordersSessionWrites=0,kupaSessionWrites=0;
    const orders=createOrdersUiCloud({storageV2PrimaryRequested:()=>true,saveSession:()=>{ordersSessionWrites++},toast:()=>{}});
    const kupa=createKupaUiCloud({storageV2PrimaryRequested:()=>true,tab:{primaryTab:true},storeSupaSession:()=>{kupaSessionWrites++},toast:()=>{}});
    assert.equal(orders.logoutCloud(),false);
    assert.equal(kupa.logoutSupabase(),false);
    assert.equal(ordersSessionWrites,0);
    assert.equal(kupaSessionWrites,0);
    assert.equal(globalThis.localStorage.length,0);
  }finally{if(prior===undefined)delete globalThis.localStorage;else globalThis.localStorage=prior}
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

test('Orders secondary tab cannot render stale Main checks after V2 cutover',async()=>{
  const previous=globalThis.localStorage;globalThis.localStorage=localStore();
  try{
    const calls=[],model={state:{checks:[{id:'obsolete'}]}};
    const lifecycle=createOrdersLifecycle({model,tab:{primaryTab:false},verifyStorageCutover:async()=>true,
      acquirePrimaryTabLock:async()=>{},loadSession:()=>null,restoreBrowserStateFallback:async()=>calls.push('main-recovered'),
      recoverSharedChecksV2Primary:async()=>{throw new Error('secondary acquired Shared Checks')},
      render:()=>{throw new Error('stale business state rendered')},showSecondaryTabGuard:()=>calls.push('guard'),
      syncFolderAccessButton:()=>calls.push('folder')});
    await lifecycle.boot();
    assert.deepEqual(calls,['main-recovered','guard','folder']);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSyncDocument as createOrdersSyncDocument} from '../netunim-orders/site/assets/js/sync/document.js';
import {createSyncDocument as createKupaSyncDocument} from '../netunim-kupa/site/assets/js/sync/document.js';
import {createStateNormalization as createKupaNormalization} from '../netunim-kupa/site/assets/js/state/normalization.js';

Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
const noop=()=>{};

function ordersFixture({primaryTab=true,readCloudMeta=async()=>({revision:7,updated_at:'2026-09-30T08:00:00Z'})}={}){
  const statuses=[],model={state:{suppliers:[]}},session={cloudBusy:false,cloudRevision:7,cloudUpdatedAt:null,localGeneration:0,cloudConflictBlocked:false};
  const api=createOrdersSyncDocument({
    model,files:{},session,ui:{},tab:{primaryTab},normalizeState:value=>value,localSnapshot:noop,markCloudPending:noop,getCloudPending:async()=>null,clearCloudPending:async()=>true,
    toast:noop,setCloud:(...args)=>statuses.push(args),prepareCloudState:(value=model.state)=>structuredClone(value),writeStateToFolder:async()=>{},readCloud:async()=>({revision:7,state:structuredClone(model.state),updated_at:'2026-09-30T08:00:00Z'}),
    rpcSave:async()=>{},merge3:()=>({state:model.state,conflicts:[]}),applyOrderCloudState:noop,cloudPendingExists:()=>false,setSave:noop,cloudEnabled:()=>true,loadCloudPendingState:()=>null,
    sameOrderCloudData:(a,b)=>JSON.stringify(a)===JSON.stringify(b),cloudHasLocalWork:()=>false,render:noop,readCloudMeta,refreshKupaReadout:async()=>true,pollSharedChecks:async()=>{},refreshCloudTimestamp:noop,
  });
  return {api,statuses,session};
}

function kupaFixture({financeRevision=3,rowFinanceRevision=3,readSupabaseDocument}={}){
  const statuses=[],saveStatuses=[],model={state:{}},normalization=createKupaNormalization({model});model.state=normalization.normalizeState({});
  const session={localGeneration:0,dbRevision:9,financeRevision,financeUpdatedAt:null,connectionMode:'supabase',backendReady:true,cloudConflictPending:false,cloudSyncBusy:false,cloudWriteBusy:false,serverInfo:{lastSavedAt:null},cloudDocumentName:'main'};
  const cloudState=normalization.prepareKupaCloudState(model.state),read=readSupabaseDocument||(async()=>({revision:9,financeRevision:rowFinanceRevision,state:structuredClone(cloudState),coreUpdatedAt:'2026-09-30T08:00:00Z'}));
  const api=createKupaSyncDocument({
    hideConnectScreen:noop,reportError:noop,model,session,checksSession:{},tab:{primaryTab:true},prepareKupaCloudState:normalization.prepareKupaCloudState,applyKupaCloudState:normalization.applyKupaCloudState,
    setSaveStatus:(...args)=>saveStatuses.push(args),setConnectedStatus:noop,setCloudHeaderStatus:(...args)=>statuses.push(args),persistImmediateBrowserSnapshot:()=>true,loadSharedChecksBase:()=>[],loadSharedChecksBankEvents:()=>[],
    listBackups:async()=>[],backupSnapshotToComputer:async()=>{},saveState:async()=>true,syncSharedChecksFromCloud:async()=>true,render:noop,getCloudPending:async()=>null,readSupabaseDocument:read,supaRest:async()=>{},
    putCloudPending:async()=>{},clearCloudPending:async()=>true,mergeKupaCloudState3Way:()=>({state:cloudState,conflicts:[]}),rebaseNewerPending:async()=>null,lastSavedCloudState:()=>null,showSecondaryTabGuard:noop,
    stageCloudPendingLocal:noop,toast:noop,pollSharedChecks:async()=>{},refreshOrdersFinanceSummary:async()=>false,refreshStorageV2CloudState:async()=>null,storageV2CloudOutboxActive:()=>false,
  });
  return {api,statuses,saveStatuses,session};
}

test('Orders reconnect settles a successful no-change poll back to synced',async()=>{
  const {api,statuses}=ordersFixture();
  assert.equal(await api.resumeAfterReconnect(),true);
  assert.deepEqual(statuses[0],['ענן: חזרה רשת…']);
  assert.deepEqual(statuses.at(-1),['ענן: מסונכרן','synced']);
});

test('Orders reconnect never paints a transient cloud status in a secondary tab',async()=>{
  const {api,statuses}=ordersFixture({primaryTab:false});
  assert.equal(await api.resumeAfterReconnect(),false);
  assert.deepEqual(statuses,[]);
});

test('Orders reconnect replaces a failed online probe with recovery status instead of staying on reconnect',async()=>{
  const {api,statuses}=ordersFixture({readCloudMeta:async()=>{throw new TypeError('Failed to fetch')}});
  assert.equal(await api.resumeAfterReconnect(),false);
  assert.deepEqual(statuses.at(-1),['ענן: ממתין להתאוששות']);
});

test('Kupa reconnect settles a successful no-change poll and its save indicator',async()=>{
  const {api,statuses,saveStatuses}=kupaFixture();
  assert.equal(await api.resumeAfterReconnect(),true);
  assert.deepEqual(statuses[0],['syncing','ענן: חזרה רשת…']);
  assert.deepEqual(statuses.at(-1),['synced','ענן: מסונכרן']);
  assert.deepEqual(saveStatuses.at(-1),['מסונכרן לענן','ok']);
});

test('Kupa finance-only poll also closes reconnect status after applying the newer finance revision',async()=>{
  const {api,statuses,saveStatuses}=kupaFixture({financeRevision:2,rowFinanceRevision:3});
  assert.equal(await api.resumeAfterReconnect(),true);
  assert.deepEqual(statuses.at(-1),['synced','ענן: מסונכרן']);
  assert.deepEqual(saveStatuses.at(-1),['מסונכרן לענן','ok']);
});

test('Kupa reconnect replaces a failed online probe with explicit recovery state',async()=>{
  const {api,statuses,saveStatuses}=kupaFixture({readSupabaseDocument:async()=>{throw new TypeError('Failed to fetch')}});
  assert.equal(await api.resumeAfterReconnect(),false);
  assert.deepEqual(statuses.at(-1),['syncing','ענן: ממתין להתאוששות']);
  assert.deepEqual(saveStatuses.at(-1),['ממתין לחידוש חיבור הענן','saving']);
});

test('Browser online handlers delegate reconnect ownership to sync modules',()=>{
  const orders=fs.readFileSync(new URL('../netunim-orders/site/assets/js/runtime-events.js',import.meta.url),'utf8');
  const kupa=fs.readFileSync(new URL('../netunim-kupa/site/assets/js/main.js',import.meta.url),'utf8');
  assert.match(orders,/tab\.primaryTab&&cloudAuth\.cloudEnabled\(\).*syncDocument\.resumeAfterReconnect\(\)/);
  assert.doesNotMatch(orders,/uiStatus\.setCloud\('ענן: חזרה רשת…'/);
  assert.match(kupa,/session\.connectionMode==='supabase'\)setTimeout\(\(\)=>void syncDocument\.resumeAfterReconnect\(\),250\)/);
  assert.doesNotMatch(kupa,/uiStatus\.setCloudHeaderStatus\('syncing','ענן: חזרה רשת…'\)/);
});

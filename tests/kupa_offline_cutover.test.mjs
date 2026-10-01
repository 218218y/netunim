import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifecycle} from '../netunim-kupa/site/assets/js/lifecycle.js';
import {createSyncRecovery} from '../netunim-kupa/site/assets/js/sync/recovery.js';

const noop=()=>{};
const requiredCallbacks=[
  'saveChecksState','syncSharedChecksFromCloud','saveSharedChecksToCloud','pollSharedChecks',
  'openLastFolder','checkDateEditorMarkup','checkDateEditorValue','commitCheckDateEditor',
  'setCheckDateValue','normalizeCheckModalDates','activeChecks','depositedChecks',
  'cashBalance','checksBalance','depositedBalance','pendingInstallments',
  'allInstallments','monthSumInstallments','expenseOccurrencesForMonth',
  'monthSumExpenses','bankBaseBalance','bankAdjustments','bankAdjustmentsTotal',
  'bankAsOfDate','sharedChecksObservedSequence','bankCurrentBalance',
  'nextCreditCycle','modalFormSnapshot','armModalDraftGuard',
  'modalHasUnsavedDraft','clearModalDraftGuard',
];

function lifecycleFixture({sharedRecovered=true,authenticated=false,capabilityFailure=false}={}){
  const events=[],model={state:{checks:[{id:'stale-main-copy'}]}},session={},ports=Object.fromEntries(requiredCallbacks.map(key=>[key,noop]));
  Object.assign(ports,{
    model,session,tab:{primaryTab:true},checksSession:{},
    normalizeState:value=>value,prepareKupaCloudState:value=>value,
    acquirePrimaryTabLock:async()=>events.push('primary-lock'),
    hydrateStorageOwner:async()=>events.push('owner'),
    restoreSupaSession:async()=>authenticated?{user:{id:'account-A'}}:null,
    ensureSyncCapabilities:async()=>{if(capabilityFailure)throw new Error('cloud capability unavailable')},
    verifyStorageCutover:async()=>true,
    openBrowserStateFallback:async options=>{
      assert.deepEqual(options,{startup:true,deferRender:true});
      events.push('main-recovered');return true;
    },
    recoverSharedChecksV2Primary:async()=>{
      events.push('shared-recovered');
      if(!sharedRecovered)return false;
      model.state.checks=[{id:'authoritative-shared-copy'}];return true;
    },
    resumeIncompleteRestore:async()=>{events.push('restore-resumed');return false},
    render:()=>events.push(`render:${model.state.checks[0]?.id}`),
    supaConfigured:()=>false,setCloudHeaderStatus:noop,setConnectUI:noop,
    requestPersistentBrowserStorage:async()=>{},
    restoreRememberedBackupTarget:async()=>{},
    tryAutoOpenSupabase:async()=>{throw new Error('offline cloud request')},
  });
  return {lifecycle:createLifecycle(ports),events,session};
}

test('Kupa V2 cutover recovers Shared Checks before offline or cloud-capability fallback displays Main',async()=>{
  const previous={navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),localStorage:Object.getOwnPropertyDescriptor(globalThis,'localStorage'),document:Object.getOwnPropertyDescriptor(globalThis,'document')};
  Object.defineProperties(globalThis,{
    navigator:{configurable:true,value:{onLine:false}},
    localStorage:{configurable:true,value:{getItem:()=>null}},
    document:{configurable:true,value:{getElementById:()=>({addEventListener:noop})}},
  });
  try{
    const ready=lifecycleFixture();
    await ready.lifecycle.boot();
    assert.deepEqual(ready.events,['primary-lock','owner','main-recovered','shared-recovered','render:authoritative-shared-copy']);
    assert.equal(ready.session.startupCloudHydrating,false);

    const missing=lifecycleFixture({sharedRecovered:false});
    await assert.rejects(missing.lifecycle.boot(),/shared_checks_cutover_recovery_required/);
    assert.equal(missing.events.some(event=>event.startsWith('render:')),false);

    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
    const unavailable=lifecycleFixture({authenticated:true,capabilityFailure:true});
    await unavailable.lifecycle.boot();
    assert.ok(unavailable.events.includes('render:authoritative-shared-copy'));
    assert.equal(unavailable.session.syncCapabilitiesError?.message,'cloud capability unavailable');
  }finally{
    for(const [key,descriptor] of Object.entries(previous)){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  }
});

test('Kupa browser fallback restores only the V2 Main checkpoint and its cloud cursor',async()=>{
  const priorNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  try{
    const model={state:{cash:[]}},session={},events=[];
    const recovery=createSyncRecovery({model,session,
      loadBrowserState:async()=>({state:{cash:[{id:'CASH-1',amount:25}]},revision:3}),
      refreshStorageV2CloudState:async()=>({seq:4,base:{version:2,revision:11,state:{cash:[]},ackSeq:4},pending:false,flight:null,control:null}),
      normalizeState:value=>structuredClone(value),prepareKupaCloudState:value=>structuredClone(value),
      hideConnectScreen:()=>events.push('hide'),setSaveStatus:()=>{},setConnectedStatus:()=>{},setCloudHeaderStatus:()=>{},startCloudPolling:()=>events.push('poll'),render:()=>events.push('render')});
    assert.equal(await recovery.openBrowserStateFallback({startup:true,deferRender:true}),true);
    assert.equal(session.dbRevision,11,'the V2 cloud cursor is authoritative over stale snapshot metadata');
    assert.equal(model.state.cash[0].id,'CASH-1');
    assert.deepEqual(events,['hide'],'startup defers render and Shared hydration to the lifecycle');
  }finally{if(priorNavigator)Object.defineProperty(globalThis,'navigator',priorNavigator);else delete globalThis.navigator}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifecycle} from '../netunim-kupa/site/assets/js/lifecycle.js';
import {createSyncRecovery} from '../netunim-kupa/site/assets/js/sync/recovery.js';
import {storageV2BootstrapStateHash} from '../shared/storage-v2-bootstrap.js';
import {webcrypto} from 'node:crypto';

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

test('Kupa interrupted cutover restores legacy Shared bank events before recomputing the frozen source hash',async()=>{
  const priorNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  try{
    const frozen={checks:[{id:'C1',amount:500}],bankEvents:[{id:'E1',seq:9,type:'deposit',checkId:'C1'}]};
    const expected=await storageV2BootstrapStateHash('shared',frozen,{cryptoImpl:webcrypto});
    const model={state:{checks:[]}},session={},checksSession={sharedChecksGeneration:0,sharedChecksBankEvents:[]};
    const recovery=createSyncRecovery({model,session,checksSession,
      loadBrowserState:async()=>({state:{checks:structuredClone(frozen.checks),cash:[]},revision:428}),
      getCloudPending:async()=>null,getSharedChecksPending:async()=>null,refreshStorageV2CloudState:async()=>null,
      normalizeState:value=>structuredClone(value),prepareKupaCloudState:value=>structuredClone(value),applyKupaCloudState:value=>structuredClone(value),
      loadSharedChecksBase:()=>structuredClone(frozen.checks),loadSharedChecksBankEvents:()=>structuredClone(frozen.bankEvents),sharedChecksPendingExists:()=>false,
      hideConnectScreen:noop,setSaveStatus:noop,setConnectedStatus:noop,setCloudHeaderStatus:noop,startCloudPolling:noop,render:()=>assert.fail('deferred recovery must not render')});
    assert.equal(await recovery.openBrowserStateFallback({startup:true,deferRender:true}),true);
    const actual=await storageV2BootstrapStateHash('shared',{checks:model.state.checks,bankEvents:checksSession.sharedChecksBankEvents},{cryptoImpl:webcrypto});
    assert.equal(actual,expected);
  }finally{if(priorNavigator)Object.defineProperty(globalThis,'navigator',priorNavigator);else delete globalThis.navigator}
});

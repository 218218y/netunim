import {withKupaStartup} from './startup_ports.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifecycle} from '../netunim-kupa/site/assets/js/lifecycle.js';
import {createSyncRecovery} from '../netunim-kupa/site/assets/js/sync/recovery.js';

const noop=()=>{};


function lifecycleFixture({sharedRecovered=true,authenticated=false,capabilityFailure=false}={}){
  const events=[],model={state:{checks:[{id:'prior-visible-check'}]}},session={},ports={openLastFolder:noop};
  Object.assign(ports,{
    model,session,tab:{primaryTab:true},checksSession:{},

    acquirePrimaryTabLock:async()=>events.push('primary-lock'),
    hydrateStorageOwner:async()=>events.push('owner'),
    restoreSupaSession:async()=>authenticated?{user:{id:'account-A'}}:null,
    ensureSyncCapabilities:async()=>{if(capabilityFailure)throw new Error('cloud capability unavailable')},
    verifyStorageV2AccountMarker:async()=>true,
    recoverBrowserV2State:async options=>{
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
  return {lifecycle:createLifecycle(withKupaStartup(ports)),events,session};
}

test('Kupa V2 recovers Shared Checks before offline or cloud-capability recovery displays Main',async()=>{
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
    await assert.rejects(missing.lifecycle.boot(),/startup_shared_recovery_required/);
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

test('Kupa V2 browser recovery preserves hydrated Shared state and never reads legacy bank events',async()=>{
  const priorNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  try{
    const sharedChecks=[{id:'C1',amount:500}],bankEvents=[{id:'E1',seq:9,type:'deposit',checkId:'C1'}];
    const model={state:{checks:structuredClone(sharedChecks)}},session={},checksSession={sharedChecksBankEvents:structuredClone(bankEvents)};
    const recovery=createSyncRecovery({model,session,checksSession,
      loadBrowserState:async()=>({v2Authoritative:true,state:{cash:[]},revision:428}),
      refreshStorageV2CloudState:async()=>null,
      normalizeState:value=>structuredClone(value),prepareKupaCloudState:value=>structuredClone(value),
      loadSharedChecksBase:()=>assert.fail('legacy checks read'),loadSharedChecksBankEvents:()=>assert.fail('legacy bank events read'),
      hideConnectScreen:()=>assert.fail('deferred recovery must not expose Main alone'),setSaveStatus:noop,setConnectedStatus:noop,setCloudHeaderStatus:noop,
      startCloudPolling:()=>assert.fail('deferred recovery must not start jobs'),render:()=>assert.fail('deferred recovery must not render')});
    assert.equal(await recovery.recoverBrowserV2State({startup:true,deferRender:true}),true);
    assert.deepEqual(model.state.checks,sharedChecks);
    assert.deepEqual(checksSession.sharedChecksBankEvents,bankEvents);
    assert.equal(session.backendReady,false);
  }finally{if(priorNavigator)Object.defineProperty(globalThis,'navigator',priorNavigator);else delete globalThis.navigator}
});

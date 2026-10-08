import test from 'node:test';
import assert from 'node:assert/strict';
import {withStorageProtocol,withOrdersStartup,withKupaStartup} from './startup_ports.mjs';
import {createLifecycle as createOrdersLifecycle} from '../netunim-orders/site/assets/js/lifecycle.js';
import {createLifecycle as createKupaLifecycle} from '../netunim-kupa/site/assets/js/lifecycle.js';
import {createUiStatus as createOrdersStatus} from '../netunim-orders/site/assets/js/ui/status.js';
import {createUiStatus as createKupaStatus} from '../netunim-kupa/site/assets/js/ui/status.js';
import {wrapMutationActions} from '../netunim-orders/site/assets/js/ui/actions.js';
import {createOrdersConnectivityRuntime} from '../netunim-orders/site/assets/js/connectivity.js';
import {createKupaConnectivityRuntime} from '../netunim-kupa/site/assets/js/connectivity.js';

const noop=()=>{};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
function browser(t){
  const toast={classList:{add:noop,remove:noop}},element={...toast,style:{},addEventListener:noop};
  const values={navigator:{onLine:false},localStorage:{getItem:()=>null},document:{getElementById:()=>element,querySelector:()=>toast}};
  for(const [name,value] of Object.entries(values)){
    const previous=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{configurable:true,value});
    t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name]});
  }
}
function fixture(app,overrides={}){
  const events=[],session={storageProtocolBlocked:true},tab={primaryTab:true},checksSession={};
  const ports=withStorageProtocol({session,tab,checksSession,files:{},
    acquirePrimaryTabLock:async()=>events.push('lock'),hydrateStorageOwner:async()=>events.push('owner'),
    storageOwnerCurrent:()=> 'local',verifyLocalStorageEngine:async()=>true,
    restoreSupaSession:async()=>null,loadSession:()=>null,ensureLocalBirth:async()=>true,
    recoverLocalV2State:async()=>{events.push('main');return {state:{checks:[]}}},
    recoverSharedChecksV2Primary:async()=>{events.push('shared');return true},
    render:()=>events.push('render'),setConnectUI:noop,setSave:noop,setCloud:noop,setCloudHeaderStatus:noop,
    setSaveStatus:noop,setConnectedStatus:noop,showSecondaryTabGuard:noop,syncFolderAccessButton:noop,
    supaConfigured:()=>false,cloudEnabled:()=>false,requestPersistentBrowserStorage:async()=>{},
    restoreRememberedBackupTarget:async()=>{},tryAutoOpenRemembered:async()=>false,showFirstRun:noop,
    loadDirHandle:async()=>null,folderBackupAvailable:()=>false,showStartupAlerts:noop,startFinanceAutoSync:noop,
    ...overrides,
  });
  const status=(app==='Orders'?createOrdersStatus:createKupaStatus)({...ports,storageRecovery:ports.storageRecovery});
  const startupPorts=app==='Orders'?withOrdersStartup({...ports,beginStartupSync:required=>status.beginStartupSync(required),setStartupDomain:(...args)=>status.setStartupDomain(...args)}):withKupaStartup(ports);
  const lifecycle=(app==='Orders'?createOrdersLifecycle:createKupaLifecycle)(startupPorts);
  return {ports,lifecycle,status,session,events,allowed:()=>app==='Orders'?status.guardStartupMutation('orders'):status.canRunInteractiveAction('save-check')};
}

for(const app of ['Orders','Kupa']){
  test(`${app} mutations remain locked throughout Main and Shared recovery, then reopen offline`,async t=>{
    browser(t);
    const main=deferred(),mainEntered=deferred(),shared=deferred(),sharedEntered=deferred();
    t.after(()=>{main.resolve();shared.resolve()});
    const f=fixture(app,{
      recoverLocalV2State:async()=>{mainEntered.resolve();await main.promise;return {state:{checks:[]}}},
      recoverSharedChecksV2Primary:async()=>{sharedEntered.resolve();await shared.promise;return true},
    });
    const boot=f.lifecycle.boot();await mainEntered.promise;
    assert.equal(f.session.storageProtocolBlocked,false,'protocol verification already passed');
    assert.equal(f.allowed(),false,'Main is not yet recovered');
    main.resolve();await sharedEntered.promise;
    assert.equal(f.allowed(),false,'Main alone cannot authorize composed state');
    assert.equal(f.events.includes('render'),false);
    shared.resolve();await boot;await f.session.startupHydrationPromise;
    assert.equal(f.allowed(),true,'verified offline recovery permits local editing');
  });

  test(`${app} a failed Shared recovery keeps mutations locked and cannot restart boot`,async t=>{
    browser(t);let calls=0;
    const failure=new Error('shared_checkpoint_corrupt');
    const f=fixture(app,{recoverSharedChecksV2Primary:async()=>{calls++;throw failure}});
    const boot=f.lifecycle.boot();await assert.rejects(boot,error=>error===failure);
    assert.equal(f.allowed(),false);
    assert.equal(f.events.includes('render'),false);
    assert.equal(f.lifecycle.boot(),boot);await assert.rejects(f.lifecycle.boot(),error=>error===failure);
    assert.equal(calls,1);
  });

  test(`${app} interrupted local birth leaves editing locked after a resolved boot`,async t=>{
    browser(t);
    const f=fixture(app,{verifyLocalStorageEngine:async()=>false,ensureLocalBirth:async()=>{throw new Error('birth_interrupted')}});
    await f.lifecycle.boot();
    assert.equal(f.allowed(),false);
    assert.equal(f.events.includes('main'),false);
    assert.equal(f.events.includes('render'),false);
  });

  test(`${app} verified secondary recovery allows viewing without granting mutation rights`,async t=>{
    browser(t);
    const f=fixture(app,{tab:{primaryTab:false},recoverReadOnlyV2State:async()=>true,recoverSharedChecksV2ReadOnly:async()=>true,
      recoverLocalV2State:async()=>assert.fail('secondary Main writer'),recoverSharedChecksV2Primary:async()=>assert.fail('secondary Shared writer')});
    await f.lifecycle.boot();assert.equal(f.ports.storageRecovery.isReady(),true);
    assert.ok(f.events.includes('render'));assert.equal(f.allowed(),false);
    if(app==='Kupa')assert.equal(f.status.canRunInteractiveAction('download-json-backup'),true);
  });

  test(`${app} network and foreground wakeups cannot race incomplete journal recovery`,async t=>{
    browser(t);
    const main=deferred(),mainEntered=deferred(),shared=deferred(),sharedEntered=deferred();
    t.after(()=>{main.resolve();shared.resolve()});
    const f=fixture(app,{
      recoverLocalV2State:async()=>{mainEntered.resolve();await main.promise;return {state:{checks:[]}}},
      recoverSharedChecksV2Primary:async()=>{sharedEntered.resolve();await shared.promise;return true},
    });
    const environment={window:new EventTarget(),document:Object.assign(new EventTarget(),{hidden:false}),navigator:{onLine:true}},jobs=new Map(),calls=[];
    let next=0;const timers={setTimeout:run=>{jobs.set(++next,run);return next},clearTimeout:id=>jobs.delete(id)};
    const access={primary:()=>true,authenticated:()=>true,blocked:()=>f.session.storageProtocolBlocked||!f.ports.storageRecovery.isReady()};
    const ports={access,timers,environment,cloud:{enabled:()=>true,connected:()=>true,resumeAfterReconnect:async()=>calls.push('cloud'),cloudPoll:async()=>calls.push('poll')},
      bank:{startAutoSync:()=>calls.push('bank'),stopAutoSync:noop},credit:{startAutoSync:async()=>calls.push('credit'),stopAutoSync:noop},
      checks:{pollSharedChecks:async()=>calls.push('checks')},finance:{startAutoSync:()=>calls.push('finance'),stopAutoSync:()=>{}},morning:{recoverPendingMorningOperation:async()=>calls.push('morning')},
      status:{startupDomainLocked:()=>false,setCloud:noop,setSaveStatus:noop,setCloudHeaderStatus:noop}};
    const runtime=(app==='Orders'?createOrdersConnectivityRuntime:createKupaConnectivityRuntime)(ports);
    t.after(()=>runtime.dispose());runtime.start();
    const wake=()=>{environment.window.dispatchEvent(new Event('online'));environment.document.dispatchEvent(new Event('visibilitychange'))};
    const boot=f.lifecycle.boot();await mainEntered.promise;wake();assert.equal(jobs.size,0);
    main.resolve();await sharedEntered.promise;wake();assert.equal(jobs.size,0);
    shared.resolve();await boot;await f.session.startupHydrationPromise;
    wake();assert.ok(jobs.size>0);
    for(const run of jobs.values())run();jobs.clear();for(let i=0;i<8;i++)await Promise.resolve();
    assert.ok(calls.includes('cloud'));assert.ok(calls.includes(app==='Orders'?'morning':'bank'));
  });
}

test('Orders recovered journals stay locked while restore recovery and the cloud cursor are pending',async t=>{
  browser(t);
  for(const phase of ['restore','cursor']){
    const gate=deferred(),entered=deferred();t.after(()=>gate.resolve());
    const f=fixture('Orders',{storageOwnerCurrent:()=> 'account',verifyStorageV2AccountMarker:async()=>true,
      verifyLocalStorageEngine:async()=>false,
      resumeIncompleteRestore:async()=>{if(phase==='restore'){entered.resolve();await gate.promise}},
      refreshStorageV2CloudState:async()=>{if(phase==='cursor'){entered.resolve();await gate.promise}return {base:{state:{checks:[]},revision:3}}},
    });
    const boot=f.lifecycle.boot();await entered.promise;
    assert.equal(f.ports.storageRecovery.snapshot().phase,'recovered');assert.equal(f.allowed(),false);
    assert.equal(f.events.includes('render'),false);
    gate.resolve();await boot;await f.session.startupHydrationPromise;assert.equal(f.allowed(),true);
  }
});

for(const app of ['Orders','Kupa'])test(`${app} readiness cannot bypass an ongoing remote hydration`,async t=>{
  browser(t);globalThis.navigator.onLine=true;
  const remote=deferred(),entered=deferred();t.after(()=>remote.resolve());
  const f=fixture(app,{storageOwnerCurrent:()=> 'account',verifyStorageV2AccountMarker:async()=>true,verifyLocalStorageEngine:async()=>false,
    restoreSupaSession:async()=>({user:{id:'account'}}),loadSession:()=>({access_token:'token'}),cloudEnabled:()=>true,
    recoverBrowserV2State:async()=>true,refreshStorageV2CloudState:async()=>({base:{state:{checks:[]},revision:3}}),
    openCloud:async()=>{entered.resolve();await remote.promise;return false},
    tryAutoOpenSupabase:async()=>{entered.resolve();await remote.promise;return false},
    syncSharedChecksFromCloud:async()=>false,refreshKupaReadout:async()=>false,
  });
  const boot=f.lifecycle.boot();await entered.promise;
  assert.equal(f.ports.storageRecovery.isReady(),true);assert.ok(f.events.includes('render'));
  assert.equal(f.allowed(),false);
  remote.resolve();await boot;await f.session.startupHydrationPromise;
  assert.equal(f.allowed(),true,'failed cloud probe leaves the recovered offline editing path intact');
});

test('Orders navigation remains available while recovery blocks classified mutations',async t=>{
  browser(t);
  const main=deferred(),entered=deferred();t.after(()=>main.resolve());
  const f=fixture('Orders',{recoverLocalV2State:async()=>{entered.resolve();await main.promise;return {state:{checks:[]}}}});
  let navigations=0,writes=0;
  const save=()=>{writes++};Object.defineProperty(save,'startupMutationDomain',{value:'orders'});
  const actions=wrapMutationActions({navigate:()=>{navigations++},save},domain=>f.status.guardStartupMutation(domain));
  const boot=f.lifecycle.boot();await entered.promise;
  actions.navigate();actions.save();assert.equal(navigations,1);assert.equal(writes,0);
  main.resolve();await boot;await f.session.startupHydrationPromise;
  actions.save();assert.equal(writes,1);
});

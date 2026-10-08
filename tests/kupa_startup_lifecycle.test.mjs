import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifecycle} from '../netunim-kupa/site/assets/js/lifecycle.js';
import {withKupaStartup} from './startup_ports.mjs';

const noop=()=>{};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(t,overrides={}){
  const events=[],session={},tab={primaryTab:true},access={authenticated:true};
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator});
  const element={addEventListener:noop};globalThis.document={getElementById:()=>element};
  t.after(()=>{if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);else delete globalThis.document});
  const controls={session,tab,storageOwnerCurrent:()=> 'account-A',verifyStorageV2AccountMarker:async()=>true,
    acquirePrimaryTabLock:async()=>events.push('lock'),hydrateStorageOwner:async()=>events.push('owner'),
    restoreSupaSession:async()=>({user:{id:'account-A'}}),loadSupaSession:()=>access.authenticated?{user:{id:'account-A'}}:null,
    recoverBrowserV2State:async()=>{events.push('main');return true},recoverSharedChecksV2Primary:async()=>{events.push('shared');return true},
    render:()=>events.push('render'),hideConnectScreen:noop,setConnectUI:noop,supaConfigured:()=>true,
    setCloudHeaderStatus:noop,setSaveStatus:noop,setConnectedStatus:noop,
    requestPersistentBrowserStorage:async()=>{},restoreRememberedBackupTarget:async()=>{},
    ensureSyncCapabilities:async()=>events.push('capabilities'),resumeIncompleteRestore:async()=>events.push('restore'),
    tryAutoOpenSupabase:async()=>{events.push('cloud');return false},showCloudNoDocument:async()=>{},
    ...overrides,
  };
  const ports=withKupaStartup(controls),lifecycle=createLifecycle(ports);
  return {events,session,tab,access,ports,lifecycle};
}

test('Kupa recovered Main and Shared display before optional folder preparation completes',async t=>{
  const entered=deferred(),gate=deferred(),f=fixture(t,{restoreRememberedBackupTarget:async()=>{entered.resolve();await gate.promise}});
  const boot=f.lifecycle.boot();await entered.promise;
  try{assert.equal(f.ports.storageRecovery.isReady(),true);assert.deepEqual(f.events,['lock','owner','main','shared','render']);assert.equal(f.session.startupCloudHydrating,true)}
  finally{gate.resolve();await boot}
});

for(const lost of ['leadership','auth','network','protocol'])test(`Kupa loss of ${lost} during local preparation prevents later restore and cloud reads`,async t=>{
  let f;f=fixture(t,{restoreRememberedBackupTarget:async()=>{
    if(lost==='leadership')f.tab.primaryTab=false;
    else if(lost==='auth')f.access.authenticated=false;
    else if(lost==='network')navigator.onLine=false;
    else f.session.storageProtocolBlocked=true;
  }});
  await f.lifecycle.boot();
  assert.equal(f.events.includes('capabilities'),false);assert.equal(f.events.includes('restore'),false);assert.equal(f.events.includes('cloud'),false);
  assert.equal(f.session.startupCloudHydrating,false);assert.equal(f.ports.storageRecovery.isReady(),true);
});

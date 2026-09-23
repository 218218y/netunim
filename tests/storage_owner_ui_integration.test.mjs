import test from 'node:test';
import assert from 'node:assert/strict';
import {createUiCloud as createOrdersUiCloud} from '../netunim-orders/site/assets/js/ui/cloud.js';
import {createUiCloud as createKupaUiCloud} from '../netunim-kupa/site/assets/js/ui/cloud.js';

function installGlobals(){
  const values=new Map(),saved=new Map();
  const set=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,writable:true,configurable:true})};
  set('localStorage',{getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)});
  set('navigator',{onLine:true});
  const nodes=new Map();
  set('document',{querySelector:()=>({value:''}),getElementById:id=>{if(!nodes.has(id))nodes.set(id,{style:{display:'flex'},value:'',textContent:''});return nodes.get(id)}});
  set('alert',()=>{});
  return ()=>{for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}};
}

function ordersHarness({remote={state:{rows:['remote']},revision:4,updated_at:'t'},sharedFails=false}={}){
  const events=[];let owner='local',reservation=null;const model={state:{rows:['local']}},session={localGeneration:0},checksSession={};
  const ui=createOrdersUiCloud({
    model,files:{},tab:{primaryTab:true},session,checksSession,ui:{},modal:()=>{},supaConfigured:()=>true,toast:()=>{},closeModal:()=>events.push('close'),authPassword:async()=>{},
    localSnapshot:()=>{events.push('checkpoint');return true},markCloudPending:()=>events.push('pending'),getCloudPending:async()=>null,clearCloudPending:async()=>true,setCloud:()=>{},showSecondaryTabGuard:()=>{},
    prepareCloudState:state=>structuredClone(state||model.state),render:()=>events.push('render'),writeStateToFolder:async()=>{},loadSession:()=>({user:{id:'B'}}),readCloud:async()=>{events.push('read-main');return remote},
    applyOrderCloudState:state=>{events.push('apply-main');model.state=structuredClone(state)},refreshKupaReadout:async()=>true,
    syncSharedChecksFromCloud:async()=>{events.push('sync-shared');if(sharedFails)throw new Error('shared-failed')},requestCloudSave:async()=>{events.push('save-main');return true},restorePendingAgainstCloud:async()=>false,
    startPolling:()=>events.push('poll'),saveSession:()=>{},renderSettings:()=>{},resumeCalendarAfterCloudLogin:async()=>{},startFinanceAutoSync:()=>{},
    prepareAuthenticatedStorageOwner:async intent=>{events.push(`reserve:${intent}`);reservation??={targetOwner:'B',intent};return reservation},storageOwnerCurrent:()=>owner,storageOwnerAdoption:()=>reservation,
    adoptAuthenticatedStorageOwner:async intent=>{events.push(`adopt:${intent}`);owner='B';reservation=null;return true},storageV2CloudOutboxActive:()=>false,storageV2PrimaryRequested:()=>false,refreshStorageV2CloudState:async()=>null,initializeStorageV2CloudCursor:async()=>true,adoptStorageV2CloudHead:async()=>true,
  });
  return {ui,events,model,session,get owner(){return owner}};
}

test('Orders local -> existing account reserves, hydrates Main+Shared, adopts owner, then renders',async()=>{
  const cleanup=installGlobals();try{
    const h=ordersHarness();assert.equal(await h.ui.openCloud({quiet:true,startPoll:false}),true);assert.equal(h.owner,'B');
    assert.ok(h.events.indexOf('reserve:load-account')<h.events.indexOf('apply-main'));
    assert.ok(h.events.indexOf('sync-shared')<h.events.indexOf('adopt:load-account'));
    assert.ok(h.events.indexOf('adopt:load-account')<h.events.indexOf('render'));
  }finally{cleanup()}
});

test('Orders local owner is not adopted or rendered when Shared preparation fails',async()=>{
  const cleanup=installGlobals();try{
    const h=ordersHarness({sharedFails:true});assert.equal(await h.ui.openCloud({quiet:true,startPoll:false}),false);assert.equal(h.owner,'local');
    assert.equal(h.events.some(x=>x.startsWith('adopt:')),false);assert.equal(h.events.includes('render'),false);if(h.session.cloudRecoveryTimer)clearTimeout(h.session.cloudRecoveryTimer);
  }finally{cleanup()}
});

test('Orders first upload reserves upload-local and adopts only after Main and Shared sync',async()=>{
  const cleanup=installGlobals();try{
    const h=ordersHarness({remote:null});await h.ui.enableCloud(true);assert.equal(h.owner,'B');
    assert.ok(h.events.indexOf('reserve:upload-local')<h.events.indexOf('pending'));
    assert.ok(h.events.indexOf('save-main')<h.events.indexOf('sync-shared'));
    assert.ok(h.events.indexOf('sync-shared')<h.events.indexOf('adopt:upload-local'));
  }finally{cleanup()}
});

test('Kupa first upload reserves target before writes and adopts only after Shared creation',async()=>{
  const cleanup=installGlobals();try{
    const events=[];let owner='local',reservation=null;const session={serverInfo:{}},checksSession={},model={state:{checks:[],cash:[{id:'x'}]}};
    const ui=createKupaUiCloud({
      session,tab:{primaryTab:true},checksSession,model,clearCloudPending:async()=>true,loadSupabaseState:async()=>{},toast:()=>{},supaConfigured:()=>true,modal:()=>{},configureCloudConnectButton:()=>{},supaProjectRef:()=>'',setCloudHeaderStatus:()=>{},loadSupaSession:()=>({user:{id:'B'}}),setConnectUI:()=>{},
      prepareKupaCloudState:state=>structuredClone(state||model.state),getCloudPending:async()=>null,storageV2CloudOutboxActive:()=>false,storageV2PrimaryRequested:()=>false,refreshStorageV2CloudState:async()=>null,loadSharedChecksBase:()=>[],loadSharedChecksBankEvents:()=>[],showSecondaryTabGuard:()=>{},openBrowserStateFallback:async()=>false,restoreSupaSession:async()=>({user:{id:'B'}}),storeSupaSession:()=>{},isSupabaseAuthError:()=>false,friendlySupabaseError:e=>String(e?.message||e),supaEnsureSession:async()=>{},readSupabaseDocument:async()=>null,syncSharedChecksFromCloud:async()=>{},applyCloudRow:async()=>{},reconcileCloudPending:async()=>true,startCloudPolling:()=>{},render:()=>events.push('render'),setConnectedStatus:()=>{},
      ensureSharedChecksForNewCloud:async()=>events.push('shared-created'),persistSupabaseState:async()=>{events.push('main-upload');return true},supaAuthPassword:async()=>{},closeModal:()=>{},showFirstRun:()=>{},confirmDialog:async()=>true,
      prepareAuthenticatedStorageOwner:async intent=>{events.push(`reserve:${intent}`);reservation??={targetOwner:'B',intent};return reservation},storageOwnerCurrent:()=>owner,storageOwnerAdoption:()=>reservation,adoptAuthenticatedStorageOwner:async intent=>{events.push(`adopt:${intent}`);owner='B';reservation=null;return true},
    });
    await ui.enableCloudFromCurrentState();assert.equal(owner,'B');assert.ok(events.indexOf('reserve:upload-local')<events.indexOf('main-upload'));assert.ok(events.indexOf('shared-created')<events.indexOf('adopt:upload-local'));
  }finally{cleanup()}
});

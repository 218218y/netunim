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

function ordersHarness({remote={state:{rows:['remote']},revision:4,updated_at:'t'},sharedFails=false,v2=true,reservedIntent=null,initialOwner='local',onReadCloud=null,adoptThrows=false}={}){
  const events=[];let owner=initialOwner,reservation=reservedIntent?{targetOwner:'B',intent:reservedIntent}:null;const model={state:{rows:['local']}},session={localGeneration:0},checksSession={};
  const ui=createOrdersUiCloud({
    model,files:{},tab:{primaryTab:true},session,checksSession,ui:{},modal:()=>{},supaConfigured:()=>true,toast:()=>{},closeModal:()=>events.push('close'),authPassword:async()=>{},
    localSnapshot:()=>{events.push('checkpoint');return true},markCloudPending:()=>events.push('pending'),getCloudPending:async()=>null,clearCloudPending:async()=>true,setCloud:()=>{},showSecondaryTabGuard:()=>{},
    prepareCloudState:state=>structuredClone(state||model.state),render:()=>events.push('render'),writeStateToFolder:async()=>{},loadSession:()=>({user:{id:'B'}}),readCloud:async()=>{events.push('read-main');onReadCloud?.({session,model});return remote},
    applyOrderCloudState:state=>{events.push('apply-main');model.state=structuredClone(state)},refreshKupaReadout:async()=>true,
    syncSharedChecksFromCloud:async()=>{events.push('sync-shared');if(sharedFails)throw new Error('shared-failed')},requestCloudSave:async()=>{events.push('save-main');return true},restorePendingAgainstCloud:async()=>false,
    startPolling:()=>events.push('poll'),saveSession:()=>{},renderSettings:()=>{},resumeCalendarAfterCloudLogin:async()=>{},startFinanceAutoSync:()=>{},
    prepareAuthenticatedStorageOwner:async intent=>{events.push(`reserve:${intent}`);reservation??={targetOwner:'B',intent};return reservation},storageOwnerCurrent:()=>owner,storageOwnerAdoption:()=>reservation,
    adoptAuthenticatedStorageOwner:async intent=>{events.push(`adopt:${intent}`);owner='B';reservation=null;return true},
    startStorageV2OwnerTransfer:async({targetOwner,intent})=>{events.push(`transfer:${intent}`);assert.equal(targetOwner,'B');if(sharedFails)throw new Error('shared-failed');owner='B';return {mainRevision:5,sharedRevision:6}},
    storageV2CloudOutboxActive:()=>owner!=='local',storageV2PrimaryRequested:()=>v2,refreshStorageV2CloudState:async()=>({seq:0,base:{revision:3,state:{rows:['base']},ackSeq:0},pending:false,flight:null,control:null}),adoptStorageV2CloudHead:async()=>{events.push('adopt-v2-head');if(adoptThrows)throw new Error('injected-v2-adoption-failure');return true},
  });
  return {ui,events,model,session,get owner(){return owner}};
}

test('Orders local V2 -> existing account activates only after detached Main+Shared recovery',async()=>{
  const cleanup=installGlobals();try{
    const h=ordersHarness();assert.equal(await h.ui.openCloud({quiet:true,startPoll:false}),true);assert.equal(h.owner,'B');
    assert.ok(h.events.includes('transfer:load-account'));
    assert.equal(h.events.includes('apply-main'),false);
    assert.ok(h.events.indexOf('transfer:load-account')<h.events.indexOf('render'));
  }finally{cleanup()}
});

test('Orders local owner stays unchanged when detached Shared preparation fails',async()=>{
  const cleanup=installGlobals();try{
    const h=ordersHarness({sharedFails:true});assert.equal(await h.ui.openCloud({quiet:true,startPoll:false}),false);assert.equal(h.owner,'local');
    assert.equal(h.events.some(x=>x.startsWith('adopt:')),false);assert.equal(h.events.includes('apply-main'),false);assert.equal(h.events.includes('render'),false);if(h.session.cloudRecoveryTimer)clearTimeout(h.session.cloudRecoveryTimer);
  }finally{cleanup()}
});

test('Orders reserved upload intent is preserved when cloud is opened again',async()=>{
  const cleanup=installGlobals();try{
    const h=ordersHarness({reservedIntent:'upload-local'});
    assert.equal(await h.ui.openCloud({quiet:true,startPoll:false}),true);
    assert.ok(h.events.includes('transfer:upload-local'));
    assert.equal(h.events.includes('transfer:load-account'),false);
  }finally{cleanup()}
});

test('Orders account open never applies a cloud read over a concurrent local V2 edit',async()=>{
  const cleanup=installGlobals();try{
    const h=ordersHarness({initialOwner:'B',onReadCloud:({session,model})=>{session.localGeneration++;model.state.rows=['newer-local']}});
    assert.equal(await h.ui.openCloud({quiet:true,startPoll:false}),false);
    assert.deepEqual(h.model.state.rows,['newer-local']);
    assert.equal(h.events.includes('adopt-v2-head'),false);
    assert.equal(h.events.includes('apply-main'),false);
    if(h.session.cloudRecoveryTimer)clearTimeout(h.session.cloudRecoveryTimer);
  }finally{cleanup()}
});

test('Orders account open leaves the visible model intact if V2 adoption fails',async()=>{
  const cleanup=installGlobals();try{
    const h=ordersHarness({initialOwner:'B',adoptThrows:true});
    assert.equal(await h.ui.openCloud({quiet:true,startPoll:false}),false);
    assert.deepEqual(h.model.state.rows,['local']);
    assert.equal(h.events.includes('apply-main'),false);
    if(h.session.cloudRecoveryTimer)clearTimeout(h.session.cloudRecoveryTimer);
  }finally{cleanup()}
});

test('Orders V2 first upload transfers without a V1 pending write or visible pre-activation state',async()=>{
  const cleanup=installGlobals();try{
    const h=ordersHarness({remote:null,v2:true});await h.ui.enableCloud(true);assert.equal(h.owner,'B');
    assert.ok(h.events.includes('transfer:upload-local'));
    assert.equal(h.events.some(event=>['pending','save-main','sync-shared','checkpoint'].includes(event)),false);
    assert.ok(h.events.indexOf('transfer:upload-local')<h.events.indexOf('render'));
  }finally{cleanup()}
});

test('Orders first upload refuses a missing V2 local engine without creating a V1 outbox',async()=>{
  const cleanup=installGlobals();try{
    const h=ordersHarness({remote:null,v2:false});assert.equal(await h.ui.enableCloud(true),false);
    assert.equal(h.owner,'local');assert.equal(h.events.includes('pending'),false);
    assert.equal(h.events.includes('save-main'),false);
  }finally{cleanup()}
});

test('Orders V2 account load leaves the local view and owner intact on detached failure',async()=>{
  const cleanup=installGlobals();try{
    const h=ordersHarness({v2:true,sharedFails:true});assert.equal(await h.ui.openCloud({quiet:true,startPoll:false}),false);
    assert.equal(h.owner,'local');assert.equal(h.events.includes('apply-main'),false);assert.equal(h.events.includes('render'),false);
    if(h.session.cloudRecoveryTimer)clearTimeout(h.session.cloudRecoveryTimer);
  }finally{cleanup()}
});

test('Kupa V2 first upload transfers without its V1 main or Shared writers',async()=>{
  const cleanup=installGlobals();try{
    const events=[];let owner='local',reservation=null;const session={serverInfo:{}},checksSession={},model={state:{checks:[],cash:[{id:'x'}]}};
    const ui=createKupaUiCloud({
      session,tab:{primaryTab:true},checksSession,model,clearCloudPending:async()=>true,loadSupabaseState:async()=>{},toast:()=>{},supaConfigured:()=>true,modal:()=>{},configureCloudConnectButton:()=>{},supaProjectRef:()=>'',setCloudHeaderStatus:()=>{},loadSupaSession:()=>({user:{id:'B'}}),setConnectUI:()=>{},
      prepareKupaCloudState:state=>structuredClone(state||model.state),getCloudPending:async()=>null,storageV2CloudOutboxActive:()=>false,storageV2PrimaryRequested:()=>true,refreshStorageV2CloudState:async()=>null,loadSharedChecksBase:()=>[],loadSharedChecksBankEvents:()=>[],showSecondaryTabGuard:()=>{},recoverBrowserV2State:async()=>false,restoreSupaSession:async()=>({user:{id:'B'}}),loadSupaSession:()=>({user:{id:'B'}}),storeSupaSession:()=>{},isSupabaseAuthError:()=>false,friendlySupabaseError:e=>String(e?.message||e),supaEnsureSession:async()=>{},readSupabaseDocument:async()=>null,syncSharedChecksFromCloud:async()=>{},applyCloudRow:async()=>{},reconcileCloudPending:async()=>true,startCloudPolling:()=>{},render:()=>events.push('render'),setConnectedStatus:()=>{},
      ensureSharedChecksForNewCloud:async()=>events.push('shared-created'),persistSupabaseState:async()=>{events.push('main-upload');return true},supaAuthPassword:async()=>{},closeModal:()=>{},showFirstRun:()=>{},confirmDialog:async()=>true,
      prepareAuthenticatedStorageOwner:async intent=>{events.push(`reserve:${intent}`);reservation??={targetOwner:'B',intent};return reservation},storageOwnerCurrent:()=>owner,storageOwnerAdoption:()=>reservation,adoptAuthenticatedStorageOwner:async intent=>{events.push(`adopt:${intent}`);owner='B';reservation=null;return true},
      startStorageV2OwnerTransfer:async({targetOwner,intent})=>{assert.equal(targetOwner,'B');events.push(`transfer:${intent}`);owner='B';return {mainRevision:1,sharedRevision:1}},
    });
    await ui.enableCloudFromCurrentState();assert.equal(owner,'B');assert.ok(events.includes('transfer:upload-local'));
    assert.equal(events.includes('main-upload'),false);assert.equal(events.includes('shared-created'),false);
  }finally{cleanup()}
});

test('Kupa first upload refuses a missing V2 local engine without legacy writes',async()=>{
  const cleanup=installGlobals();try{
    const events=[],model={state:{checks:[]}};
    const ui=createKupaUiCloud({tab:{primaryTab:true},model,session:{},checksSession:{},supaConfigured:()=>true,
      restoreSupaSession:async()=>({user:{id:'B'}}),supaEnsureSession:async()=>{},storageOwnerCurrent:()=> 'local',storageV2PrimaryRequested:()=>false,
      setCloudHeaderStatus:()=>{},isSupabaseAuthError:()=>false,friendlySupabaseError:error=>error.message,
      persistSupabaseState:async()=>events.push('legacy-main'),ensureSharedChecksForNewCloud:async()=>events.push('legacy-checks')});
    assert.equal(await ui.enableCloudFromCurrentState(),false);
    assert.deepEqual(events,[]);
  }finally{cleanup()}
});

test('Kupa password login with upload intent enters only the V2 owner transfer',async()=>{
  const cleanup=installGlobals();try{
    document.getElementById('supaEmail').value='owner@example.test';
    document.getElementById('supaPassword').value='password';
    const events=[];let authenticated=false,owner='local';
    const ui=createKupaUiCloud({tab:{primaryTab:true},model:{state:{checks:[]}},session:{},checksSession:{},
      supaConfigured:()=>true,restoreSupaSession:async()=>authenticated?{user:{id:'B'}}:null,prepareKupaCloudState:state=>structuredClone(state),
      supaAuthPassword:async()=>{authenticated=true;events.push('auth')},supaEnsureSession:async()=>{},
      storageOwnerCurrent:()=>owner,storageV2PrimaryRequested:()=>true,loadSupaSession:()=>({user:{id:'B'}}),
      startStorageV2OwnerTransfer:async()=>{events.push('transfer');owner='B';return {mainRevision:1,sharedRevision:1}},
      setCloudHeaderStatus:()=>{},setConnectedStatus:()=>{},render:()=>{},startCloudPolling:()=>{},closeModal:()=>events.push('close'),friendlySupabaseError:error=>error.message,isSupabaseAuthError:()=>false,
      persistSupabaseState:async()=>events.push('legacy-main'),ensureSharedChecksForNewCloud:async()=>events.push('legacy-checks')});
    assert.equal(await ui.connectSupabaseFromLogin('upload'),true);
    assert.deepEqual(events,['auth','transfer','close']);
  }finally{cleanup()}
});

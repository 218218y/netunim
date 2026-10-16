import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackupRestore as createOrdersRestore} from '../netunim-orders/site/assets/js/ui/backup-restore.js';
import {createBackupRestore as createKupaRestore} from '../netunim-kupa/site/assets/js/ui/backup-restore.js';
import {createRestoreGroup} from '../shared/restore-groups.js';

const noop=()=>{};
for(const app of ['orders','kupa'])for(const sourceOwner of [null,'another-account','wrong-app'])test(`${app} pending restore with ${sourceOwner||'no'} owner evidence cannot write under the current account`,async t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator});
  const group=await createRestoreGroup({appSite:sourceOwner==='wrong-app'?(app==='orders'?'kupa':'orders'):app,
    owner:sourceOwner==='wrong-app'?'current':sourceOwner,main:{state:{notes:[]},baseRevision:1}}),before=structuredClone(group);
  let writes=0;
  const api=(app==='orders'?createOrdersRestore:createKupaRestore)({model:{state:{}},session:{localGeneration:0},tab:{primaryTab:true},files:{},checksSession:{},
    view:{toast:noop},cloud:{loadSession:()=>({user:{id:'current'}}),loadSupaSession:()=>({user:{id:'current'}}),
      accountScope:()=>({owner:'current',epoch:1}),restoreGroupStore:{loadPending:async()=>group},
      stageRestoreGroup:async()=>{writes++},applyRestoreGroup:async()=>{writes++}},
    storage:{storageOwnerCurrent:()=> 'current',storageV2LocalPrimary:()=>true}});
  await assert.rejects(api.resumeIncompleteRestore(),{code:sourceOwner==='wrong-app'?'restore_recovery_app_mismatch':'restore_recovery_owner_unproven'});
  assert.equal(writes,0);assert.deepEqual(group,before);
});
for(const app of ['orders','kupa'])for(const transition of ['owner','edit']){
  test(`${app} restore confirmation cannot authorize a replacement owner or a later edit`,async t=>{
    t.mock.method(console,'error',noop);
    const oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
    Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
    t.after(()=>{if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator});
    const model={state:{notes:[{id:'N',content:'original'}],checks:[]}},session={localGeneration:0,connectionMode:'supabase',backendReady:true};
    let owner='account-a',approve,reads=0;
    const read=async()=>{reads++;return null};
    const restore=(app==='orders'?createOrdersRestore:createKupaRestore)({model,session,tab:{primaryTab:true},files:{},checksSession:{},
      projection:{normalizeState:structuredClone,prepareState:()=>structuredClone(model.state)},
      view:{confirmDialog:()=>new Promise(resolve=>{approve=resolve}),toast:noop,render:noop,invalidateAllViewDomains:noop},
      local:{folderBackupAvailable:()=>false},cloud:{cloudEnabled:()=>true},
      storage:{storageV2LocalPrimary:()=>true,storageOwnerCurrent:()=>owner,refreshStorageV2CloudState:read,
        sharedChecksV2:{localReady:true,cloudState:read}},
    });
    const restoring=(app==='orders'?restore.restoreNormalizedState:restore.restoreState)({notes:[{id:'N',content:'historical'}],checks:[]},{beforeDownload:false});
    if(transition==='owner')owner='account-b';else session.localGeneration++;
    model.state.notes[0].content=transition==='owner'?'replacement owner note':'later edit';
    const retained=structuredClone(model.state);
    approve(true);await restoring.catch(()=>false);
    assert.equal(reads,0,'a stale approval must be rejected before reading any new journal authority');
    assert.deepEqual(model.state,retained);
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {createLegacyLocalBirthSource} from '../netunim-kupa/site/assets/js/storage/local-birth-source.js';
import {createLifecycle} from '../netunim-kupa/site/assets/js/lifecycle.js';
import {createStoragePersistence} from '../netunim-kupa/site/assets/js/storage/persistence.js';
import {createStorageV2LocalBirth} from '../shared/storage-v2-local-birth.js';
import {BROWSER_STATE_KEY,SHARED_CHECKS_EVENTS_KEY} from '../netunim-kupa/site/assets/js/state/constants.js';

const noop=()=>{};
function storage(values={}){const data=new Map(Object.entries(values));return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}}

test('Kupa local birth source chooses newest durable V1 snapshot without repairing V1',async()=>{
  const local=storage({[BROWSER_STATE_KEY]:JSON.stringify({snapshotSeq:2,state:{checks:[{id:'old'}],cash:[]}}),[SHARED_CHECKS_EVENTS_KEY]:'[]'});
  let reads=0,writes=0;
  const source=createLegacyLocalBirthSource({storage:{getItem:key=>{reads++;return local.getItem(key)},setItem:()=>{writes++}},
    idbGet:async()=>({snapshotSeq:3,state:{checks:[{id:'new'}],cash:[]}}),normalizeState:value=>structuredClone(value)});
  const result=await source();
  assert.deepEqual(result.mainState.checks.map(check=>check.id),['new']);
  assert.deepEqual(result.sharedState.checks,result.mainState.checks);
  assert.deepEqual(result.sharedState.bankEvents,[]);
  assert.ok(reads>0);assert.equal(writes,0);
});

test('Kupa local birth refuses equal-sequence V1 snapshots with different data',async()=>{
  const local=storage({[BROWSER_STATE_KEY]:JSON.stringify({snapshotSeq:4,state:{checks:[{id:'one'}],cash:[]}})});
  const source=createLegacyLocalBirthSource({storage:local,idbGet:async()=>({snapshotSeq:4,state:{checks:[{id:'two'}],cash:[]}}),normalizeState:value=>value});
  await assert.rejects(source(),/kupa_local_birth_snapshot_divergence/);
});

test('Kupa fresh local birth does not create an absent legacy IndexedDB database',async()=>{
  const previous=globalThis.indexedDB;let reads=0;
  globalThis.indexedDB={databases:async()=>[]};
  try{
    const source=createLegacyLocalBirthSource({storage:storage(),idbGet:async()=>{reads++;throw Error('legacy DB opened')},normalizeState:value=>structuredClone(value)});
    const frozen=await source();assert.equal(reads,0);assert.deepEqual(frozen.sharedState,{checks:[],bankEvents:[]});
  }finally{if(previous===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=previous}
});

test('Kupa migration source carries a meaningful spreadsheet without writing during discovery',async()=>{
  const workbook={version:2,sheets:[{id:'s',name:'Sheet'}],columns:[{id:'c',sheetId:'s',title:'Text'}],rows:[{id:'r',sheetId:'s',cells:{c:'saved'}}]};
  let normalizations=0;
  const source=createLegacyLocalBirthSource({storage:storage({[BROWSER_STATE_KEY]:JSON.stringify({snapshotSeq:1,state:{checks:[],notesSheet:workbook}})}),
    idbGet:async()=>({snapshotSeq:2,state:{checks:[],notesSheet:workbook}}),normalizeState:value=>{normalizations++;return {checks:value.checks}}});
  const frozen=await source();
  assert.deepEqual(frozen.auxiliaryState,{workbook});
  assert.equal(normalizations,1);
});

test('Kupa legacy workbook is frozen with the birth plan and retried after a crash',async()=>{
  const workbook={version:2,sheets:[{id:'s',name:'Sheet'}],columns:[{id:'c',sheetId:'s',title:'Text'}],rows:[{id:'r',sheetId:'s',cells:{c:'saved'}}]};
  let plan=null,marker=null,main=null,shared=null,workbookRecord=null,sourceReads=0,crash=true;
  const db={readLocalBirth:async()=>structuredClone(plan),beginLocalBirth:async(_scope,record)=>plan=structuredClone(record),
    advanceLocalBirth:async(_scope,_id,phase,next)=>{if(phase==='shared-initialized'&&crash){crash=false;throw Error('crash-after-workbook')};plan={...plan,phase:next};return structuredClone(plan)},
    readLocalEngine:async()=>marker,markLocalEngine:async()=>marker={version:2,kind:'local-engine',scope:'kupa:local',app:'kupa',owner:'local'}};
  const cache=storage(),make=()=>createStorageV2LocalBirth({app:'kupa',owner:()=> 'local',primary:()=>true,db,storage:cache,operationId:()=> 'birth-workbook',
    main:{initializeLocal:async value=>{main=structuredClone(value)},recover:async()=>main&&{state:structuredClone(main)}},
    shared:{initializeLocal:async({state})=>{shared=structuredClone(state)},recover:async()=>shared&&{state:structuredClone(shared)}},
    readSource:async()=>{sourceReads++;return {mainState:{checks:[]},sharedState:{checks:[],bankEvents:[]},auxiliaryState:{workbook}}},
    applyAuxiliary:async value=>{workbookRecord=structuredClone(value.workbook)},verifyAuxiliary:async value=>JSON.stringify(workbookRecord)===JSON.stringify(value.workbook),
    verifyLegacyClean:async()=>true});
  await assert.rejects(make().begin(),/crash-after-workbook/);
  assert.equal(plan.phase,'shared-initialized');assert.equal(marker,null);assert.deepEqual(workbookRecord,workbook);
  await make().resume();assert.equal(sourceReads,1);assert.equal(plan.phase,'complete');assert.ok(marker);
});

test('Kupa remembered file cannot silently replace a different local V2 checkpoint',async()=>{
  let captured=0,applied=0;
  const persistence=createStoragePersistence({model:{state:{checks:[],cash:[{id:'browser'}]}},session:{},files:{dataFileHandle:{name:'kupa.json'}},checksSession:{},
    storageV2Primary:()=>true,recoverStorageV2State:async()=>({state:{checks:[],cash:[{id:'browser'}]}}),
    readJsonHandle:async()=>({checks:[],cash:[{id:'file'}]}),stateFromPayload:()=>({state:{checks:[],cash:[{id:'file'}]},meta:{}}),
    captureLegacyWorkbook:async()=>{captured++},replaceStorageV2CurrentState:async()=>{applied++}});
  await assert.rejects(persistence.loadState({automatic:true}),/storage_v2_local_file_requires_confirmation/);
  assert.equal(captured,0);assert.equal(applied,0);
});

const requiredCallbacks=[
  'saveChecksState','syncSharedChecksFromCloud','saveSharedChecksToCloud','pollSharedChecks','openLastFolder',
  'checkDateEditorMarkup','checkDateEditorValue','commitCheckDateEditor','setCheckDateValue','normalizeCheckModalDates',
  'activeChecks','depositedChecks','cashBalance','checksBalance','depositedBalance','pendingInstallments',
  'allInstallments','monthSumInstallments','expenseOccurrencesForMonth','monthSumExpenses','bankBaseBalance',
  'bankAdjustments','bankAdjustmentsTotal','bankAsOfDate','sharedChecksObservedSequence','bankCurrentBalance',
  'nextCreditCycle','modalFormSnapshot','armModalDraftGuard','modalHasUnsavedDraft','clearModalDraftGuard',
];

function bootFixture({primary=true,failBirth=false}={}){
  const events=[],model={state:{checks:[]}},session={},ports=Object.fromEntries(requiredCallbacks.map(key=>[key,noop]));let marker=false;
  Object.assign(ports,{model,session,checksSession:{},tab:{primaryTab:primary},normalizeState:value=>value,prepareKupaCloudState:value=>value,
    acquirePrimaryTabLock:async()=>events.push('lock'),hydrateStorageOwner:async()=>events.push('owner'),
    restoreSupaSession:async()=>null,storageOwnerCurrent:()=> 'local',hydrateStorageTransition:async()=>events.push('transition'),
    hydrateLocalBirth:async()=>events.push('birth-hydrated'),verifyStorageCutover:async()=>false,
    verifyLocalStorageEngine:async()=>marker,ensureLocalBirth:async()=>{events.push('birth');if(failBirth)throw Error('birth-failed');marker=true;return true},
    recoverLocalV2State:async()=>{events.push('main');model.state.checks=[{id:'stale'}];return true},
    recoverSharedChecksV2Primary:async()=>{events.push('shared');model.state.checks=[{id:'authoritative'}];return true},
    openBrowserStateFallback:async()=>{throw Error('V1 fallback reached')},
    render:()=>events.push('render'),showSecondaryTabGuard:()=>events.push('secondary'),
    setConnectUI:()=>events.push('blocked'),setCloudHeaderStatus:noop,supaConfigured:()=>false,
    requestPersistentBrowserStorage:async()=>{},restoreRememberedBackupTarget:async()=>{},
    tryAutoOpenRemembered:async()=>false,showFirstRun:()=>events.push('first-run'),
  });
  return {lifecycle:createLifecycle(ports),events,session};
}

test('Kupa production startup finishes local birth and hydrates Shared before presenting data',async()=>{
  const previous={navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),localStorage:Object.getOwnPropertyDescriptor(globalThis,'localStorage'),document:Object.getOwnPropertyDescriptor(globalThis,'document')};
  Object.defineProperties(globalThis,{navigator:{configurable:true,value:{onLine:false}},localStorage:{configurable:true,value:storage()},document:{configurable:true,value:{getElementById:()=>({addEventListener:noop})}}});
  try{
    const ready=bootFixture();await ready.lifecycle.boot();
    assert.deepEqual(ready.events,['lock','owner','transition','birth-hydrated','birth','main','shared','first-run']);
    assert.equal(ready.session.storageProtocolBlocked,false);
    const blocked=bootFixture({failBirth:true});await blocked.lifecycle.boot();
    assert.deepEqual(blocked.events,['lock','owner','transition','birth-hydrated','birth','blocked']);
    const secondary=bootFixture({primary:false});await secondary.lifecycle.boot();
    assert.deepEqual(secondary.events,['lock','owner','transition','birth-hydrated','secondary']);
  }finally{for(const [key,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}
});

test('Kupa unmarked browser for a fenced account stops before V1 recovery and render',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  try{
    const events=[],ports=Object.fromEntries(requiredCallbacks.map(key=>[key,noop]));
    Object.assign(ports,{model:{state:{checks:[]}},session:{},checksSession:{},tab:{primaryTab:true},normalizeState:value=>value,prepareKupaCloudState:value=>value,
      acquirePrimaryTabLock:async()=>{},hydrateStorageOwner:async()=>{},restoreSupaSession:async()=>({user:{id:'account'}}),storageOwnerCurrent:()=> 'account',authenticatedOwner:()=> 'account',
      readStorageProtocolState:async()=>({orders:2,kupa:2,sharedChecks:2}),verifyStorageCutover:async()=>false,verifyLocalStorageEngine:async()=>false,
      openBrowserStateFallback:async()=>{throw Error('stale V1 loaded')},render:()=>{throw Error('stale state displayed')},setConnectUI:()=>events.push('blocked')});
    await createLifecycle(ports).boot();assert.deepEqual(events,['blocked']);assert.equal(ports.session.storageProtocolBlocked,true);
  }finally{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator}
});

test('Kupa fenced stale browser hydrates cloud V2 before opening the screen',async()=>{
  const previous={navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator'),localStorage:Object.getOwnPropertyDescriptor(globalThis,'localStorage'),document:Object.getOwnPropertyDescriptor(globalThis,'document')};
  Object.defineProperties(globalThis,{navigator:{configurable:true,value:{onLine:true}},localStorage:{configurable:true,value:storage()},
    document:{configurable:true,value:{getElementById:()=>({addEventListener:noop})}}});
  try{
    let marker=false;const events=[],ports=Object.fromEntries(requiredCallbacks.map(key=>[key,noop]));
    Object.assign(ports,{model:{state:{checks:[]}},session:{},checksSession:{},tab:{primaryTab:true},normalizeState:value=>value,prepareKupaCloudState:value=>value,
      acquirePrimaryTabLock:async()=>{},hydrateStorageOwner:async()=>{},restoreSupaSession:async()=>({user:{id:'account'}}),
      storageOwnerCurrent:()=> 'account',authenticatedOwner:()=> 'account',readStorageProtocolState:async()=>({orders:2,kupa:2,sharedChecks:2}),
      verifyStorageCutover:async()=>marker,verifyLocalStorageEngine:async()=>false,
      recoverFencedAccount:async()=>{events.push('cloud-adoption');marker=true},
      openBrowserStateFallback:async()=>{assert.equal(marker,true);events.push('main-v2');return true},
      recoverSharedChecksV2Primary:async()=>{events.push('shared-v2');return true},
      ensureSyncCapabilities:async()=>true,requestPersistentBrowserStorage:async()=>{},restoreRememberedBackupTarget:async()=>{},
      supaConfigured:()=>true,render:()=>events.push('render'),tryAutoOpenSupabase:async()=>true,setCloudHeaderStatus:noop,setConnectUI:()=>events.push('blocked')});
    await createLifecycle(ports).boot();
    assert.ok(events.indexOf('cloud-adoption')<events.indexOf('main-v2'));
    assert.ok(events.indexOf('main-v2')<events.indexOf('shared-v2'));
    assert.equal(events.includes('blocked'),false);assert.equal(ports.session.storageProtocolBlocked,false);
  }finally{for(const [key,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}}
});

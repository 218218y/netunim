import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncDocument as createKupaSync} from '../netunim-kupa/site/assets/js/sync/document.js';
import {createSyncDocument as createOrdersSync} from '../netunim-orders/site/assets/js/sync/document.js';
import {createUiCloud as createOrdersCloudUi} from '../netunim-orders/site/assets/js/ui/cloud.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/composition/state-normalization.js';

const clone=structuredClone,noop=()=>{};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function environment(){Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});globalThis.localStorage={getItem:()=>null,setItem:noop,removeItem:noop}}
function kupaFixture({adopt=async()=>{},secondary=async()=>true,reconcile=noop,assertAccountOwner=noop}={}){
  environment();
  const model={state:{}},normalization=createStateNormalization({model});
  model.state=normalization.normalizeState({notes:[{id:'N',content:'local',createdAt:'2026-10-08',updatedAt:'2026-10-08'}]});
  const session={localGeneration:0,dbRevision:10,financeRevision:2,serverInfo:{lastSavedAt:'old'}},tab={primaryTab:true},controls=[];
  const cloud={seq:0,base:{revision:10,ackSeq:0,state:normalization.prepareKupaCloudState(model.state)},pending:false,flight:null,control:null};
  const remote={revision:11,financeAvailable:false,coreUpdatedAt:'new',state:clone(model.state)};remote.state.notes[0].content='remote';
  const api=createKupaSync({model,session,tab,checksSession:{},...normalization,assertAccountOwner,
    refreshStorageV2CloudState:async()=>clone(cloud),storageV2CloudOutboxActive:()=>true,
    adoptStorageV2CloudHead:async(revision,state,options)=>{await adopt({model,session,tab,cloud,state,options});cloud.base={revision,ackSeq:cloud.seq,state:clone(options.cloudState)};return {seq:cloud.seq,revision,pending:cloud.pending,control:clone(cloud.control)}},
    setStorageV2CloudControl:async value=>{controls.push(clone(value));cloud.control=clone(value)},
    domainRevisions:{reconcile},syncSharedChecksFromCloud:secondary,refreshOrdersFinanceSummary:async()=>false,
    listBackups:async()=>[],backupSnapshotToComputer:async()=>{},setConnectedStatus:noop,setSaveStatus:noop,setCloudHeaderStatus:noop,hideConnectScreen:noop,render:noop,reportError:noop});
  const stop=()=>{session.cloudPollingEnabled=false;clearTimeout(session.cloudPollTimer)};
  return {api,model,session,tab,cloud,remote,controls,stop};
}

test('Kupa remote hydration publishes neither records nor revision until its durable commit completes',async t=>{
  const started=deferred(),release=deferred(),f=kupaFixture({adopt:async()=>{started.resolve();await release.promise}});t.after(f.stop);
  const before=clone(f.model.state),loading=f.api.applyCloudRow(f.remote);await started.promise;
  try{assert.deepEqual(f.model.state,before);assert.equal(f.session.dbRevision,10)}finally{release.resolve();await loading}
  assert.equal(f.model.state.notes[0].content,'remote');assert.equal(f.session.dbRevision,11);
});

test('Kupa aborted hydration retains the visible local identity, data and revision',async t=>{
  const f=kupaFixture({adopt:async()=>{throw new DOMException('injected abort','AbortError')}});t.after(f.stop);
  const before=clone(f.model.state),base=clone(f.cloud.base);
  await assert.rejects(f.api.applyCloudRow(f.remote),{name:'AbortError'});
  assert.deepEqual(f.model.state,before);assert.deepEqual(f.cloud.base,base);assert.equal(f.session.dbRevision,10);
});

test('Kupa local edit during hydration stays visible and creates a durable publication fence',async t=>{
  const f=kupaFixture({adopt:async({model,session,cloud})=>{model.state.notes[0].content='later edit';session.localGeneration++;cloud.seq++;cloud.pending=true}});t.after(f.stop);
  await assert.rejects(f.api.applyCloudRow(f.remote),/cloud_hydration_publication_stale/);
  assert.equal(f.model.state.notes[0].content,'later edit');assert.equal(f.cloud.pending,true);
  assert.equal(f.controls.at(-1).conflict.kind,'concurrent-hydration');
});

test('Kupa Shared failure after Main commit cannot roll back its committed Main cursor',async t=>{
  const f=kupaFixture({secondary:async()=>{throw new TypeError('Failed to fetch')}});t.after(f.stop);
  await assert.rejects(f.api.applyCloudRow(f.remote),/Failed to fetch/);
  assert.equal(f.cloud.base.revision,11);assert.equal(f.session.dbRevision,11);assert.equal(f.model.state.notes[0].content,'remote');
});

test('Kupa leadership loss after commit cannot publish remote records or write a control as a secondary',async t=>{
  const f=kupaFixture({adopt:async({tab})=>{tab.primaryTab=false}});t.after(f.stop);const before=clone(f.model.state);
  await assert.rejects(f.api.applyCloudRow(f.remote),/cloud_hydration_publication_stale/);
  assert.deepEqual(f.model.state,before);assert.equal(f.session.dbRevision,10);assert.equal(f.controls.length,0);
});

test('Kupa logout during commit cannot reactivate the cloud session or publish its old read',async t=>{
  let authenticated=true;
  const f=kupaFixture({assertAccountOwner:()=>{if(!authenticated)throw new Error('storage_owner_account_mismatch')},adopt:async()=>{authenticated=false}});t.after(f.stop);
  const before=clone(f.model.state);
  await assert.rejects(f.api.applyCloudRow(f.remote),/storage_owner_account_mismatch/);
  assert.deepEqual(f.model.state,before);assert.equal(f.session.dbRevision,10);assert.equal(f.controls.length,0);assert.equal(f.session.backendReady,undefined);
});

test('Kupa publication exception retains the committed head and persists a recovery fence',async t=>{
  const f=kupaFixture({reconcile:()=>{throw new Error('injected publication failure')}});t.after(f.stop);
  await assert.rejects(f.api.applyCloudRow(f.remote),/injected publication failure/);
  assert.equal(f.cloud.base.revision,11);assert.equal(f.controls.at(-1).conflict.kind,'cloud-publication-failed');
});

test('Kupa retains an existing conflict observed after commit without replacing its evidence',async t=>{
  const conflict={kind:'entity-conflict',recordId:'N',local:'local',remote:'remote'};
  const f=kupaFixture({adopt:async({cloud})=>{cloud.control={conflict:clone(conflict)}}});t.after(f.stop);
  await assert.rejects(f.api.applyCloudRow(f.remote),/cloud_hydration_publication_stale/);
  assert.deepEqual(f.cloud.control.conflict,conflict);assert.equal(f.controls.length,0);assert.equal(f.model.state.notes[0].content,'local');
});

test('Kupa Main publication preserves Shared Checks and Finance that advance during the commit',async t=>{
  const f=kupaFixture({adopt:async({model,session})=>{model.state.checks=[{id:'C',number:'123',amount:1,status:'open'}];model.state.bank={...model.state.bank,source:'hapoalim',currentBalance:900,updatedAt:'new-finance'};session.financeRevision=3}});t.after(f.stop);
  await f.api.applyCloudRow(f.remote);
  assert.equal(f.model.state.notes[0].content,'remote');assert.equal(f.model.state.checks[0].id,'C');
  assert.equal(f.model.state.bank.currentBalance,900);assert.equal(f.session.financeRevision,3);
});

test('Kupa Main hydration without Finance availability retains the independent Finance cache',async t=>{
  const f=kupaFixture();t.after(f.stop);
  Object.assign(f.model.state.bank,{source:'hapoalim',currentBalance:900,updatedAt:'2026-10-08T06:00:00Z',asOfDate:'2026-10-08',bankSyncAt:'2026-10-08T06:00:00Z'});
  f.model.state.creditSync.syncedAt='2026-10-08T07:00:00.000Z';
  const bank=clone(f.model.state.bank),credit=clone(f.model.state.creditSync);
  f.remote.state.bank.currentBalance=1;f.remote.state.creditSync.syncedAt='2026-10-07T07:00:00Z';
  await f.api.applyCloudRow(f.remote);
  assert.deepEqual(f.model.state.bank,bank);assert.deepEqual(f.model.state.creditSync,credit);assert.equal(f.session.financeRevision,2);
  assert.equal(f.model.state.notes[0].content,'remote');assert.equal(f.session.serverInfo.lastSavedAt,'new');
});

test('Orders interactive cloud opening cannot publish after leadership changes during adoption',async t=>{
  environment();const model={state:{notes:[{id:'N',content:'local'}],checks:[]}},session={localGeneration:0,cloudRevision:10},tab={primaryTab:true};
  const before=clone(model.state),controls=[];
  const api=createOrdersCloudUi({model,files:{},tab,session,checksSession:{},loadSession:()=>({user:{id:'account-A'}}),
    storageOwnerCurrent:()=> 'account-A',storageV2CloudOutboxActive:()=>true,
    storageV2CommitPromise:()=>Promise.resolve(),refreshStorageV2CloudState:async()=>({seq:0,base:{revision:10,ackSeq:0},pending:false,flight:null,control:null}),
    readCloud:async()=>({revision:11,state:{notes:[{id:'N',content:'remote'}]}}),adoptStorageV2CloudHead:async()=>{tab.primaryTab=false;return {seq:0,revision:11}},
    setStorageV2CloudControl:async value=>controls.push(value),applyOrderCloudState:state=>{model.state=clone(state)},prepareCloudState:clone,
    setCloud:noop,render:noop,toast:noop});
  t.mock.method(console,'error',noop);
  assert.equal(await api.openCloud({quiet:true,hydrateSecondary:false,startPoll:false}),false);
  assert.deepEqual(model.state,before);assert.equal(session.cloudRevision,10);assert.equal(controls.length,0);
});

for(const method of ['cloudPoll','refreshForMorningRecovery'])test(`Orders ${method} cannot publish after losing primary leadership during adoption`,async()=>{
  environment();const model={state:{notes:[{id:'N',content:'local'}],checks:[]}},session={localGeneration:0,cloudRevision:10},tab={primaryTab:true};
  const before=clone(model.state),remote={revision:11,state:{notes:[{id:'N',content:'remote'}]}};
  const api=createOrdersSync({model,session,tab,files:{},toast:noop,setCloud:noop,prepareCloudState:clone,
    cloudEnabled:()=>true,cloudHasLocalWork:()=>false,sameOrderCloudData:(a,b)=>JSON.stringify(a.notes)===JSON.stringify(b.notes),
    readCloud:async()=>clone(remote),readCloudMeta:async()=>({revision:11}),
    refreshStorageV2CloudState:async()=>({seq:0,base:{revision:10,ackSeq:0},pending:false,flight:null,control:null}),
    adoptStorageV2CloudHead:async()=>{tab.primaryTab=false;return {seq:0,revision:11}},
    applyOrderCloudState:state=>{model.state=clone(state)},render:noop,refreshCloudTimestamp:noop,pollSharedChecks:async()=>{},refreshKupaReadout:async()=>false});
  assert.equal(await api[method](),false);assert.deepEqual(model.state,before);assert.equal(session.cloudRevision,10);
});

for(const method of ['cloudPoll','refreshForMorningRecovery'])test(`Orders ${method} retains a local edit made during commit and persists a recovery fence`,async()=>{
  environment();const model={state:{notes:[{id:'N',content:'local'}],checks:[]}},session={localGeneration:0,cloudRevision:10},tab={primaryTab:true},controls=[];
  const api=createOrdersSync({model,session,tab,files:{},toast:noop,setCloud:noop,prepareCloudState:clone,
    cloudEnabled:()=>true,cloudHasLocalWork:()=>false,sameOrderCloudData:(a,b)=>JSON.stringify(a.notes)===JSON.stringify(b.notes),
    readCloud:async()=>({revision:11,state:{notes:[{id:'N',content:'remote'}]}}),readCloudMeta:async()=>({revision:11}),
    refreshStorageV2CloudState:async()=>({seq:0,base:{revision:10,ackSeq:0},pending:false,flight:null,control:null}),
    adoptStorageV2CloudHead:async()=>{session.localGeneration++;model.state.notes[0].content='later edit';return {seq:0,revision:11}},
    setStorageV2CloudControl:async value=>controls.push(value),
    applyOrderCloudState:state=>{model.state=clone(state)},render:noop,refreshCloudTimestamp:noop,pollSharedChecks:async()=>{},refreshKupaReadout:async()=>false});
  assert.equal(await api[method](),false);assert.equal(model.state.notes[0].content,'later edit');assert.equal(session.cloudRevision,10);
  assert.equal(session.cloudConflictBlocked,true);assert.equal(controls.at(-1).conflict.kind,'concurrent-hydration');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncDocument} from '../netunim-kupa/site/assets/js/sync/document.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/composition/state-normalization.js';

const noop=()=>{},clone=structuredClone;
function gate(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
function fixture(t){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator});
  const model={state:{}},normalization=createStateNormalization({model});
  model.state=normalization.normalizeState({notes:[{id:'N',content:'original'}]});
  const session={connectionMode:'supabase',backendReady:true,dbRevision:5,localGeneration:0,serverInfo:{}};
  const tab={primaryTab:true},events=[],head={seq:0,base:{revision:5,ackSeq:0,owner:'A:kupa',epoch:'E',state:normalization.prepareKupaCloudState(model.state)},pending:false,flight:null,control:null};
  let authorized=true;
  const ports={model,session,tab,checksSession:{},...normalization,
    storageV2CloudOutboxActive:()=>authorized,assertAccountOwner:()=>{if(!authorized)throw new Error('storage_owner_session_mismatch')},
    refreshStorageV2CloudState:async()=>clone(head),materializeStorageV2CloudFlight:async()=>null,
    setSaveStatus:(...args)=>events.push(['save',...args]),setCloudHeaderStatus:(...args)=>events.push(['cloud',...args]),toast:(...args)=>events.push(['toast',...args]),
    showSecondaryTabGuard:noop,backupSnapshotToComputer:async()=>{},render:noop,reportError:noop,
  };
  const api=createSyncDocument({...ports,
    refreshStorageV2CloudState:(...args)=>ports.refreshStorageV2CloudState(...args),
    materializeStorageV2CloudFlight:(...args)=>ports.materializeStorageV2CloudFlight(...args),
    supaRest:(...args)=>ports.supaRest(...args),acknowledgeStorageV2CloudFlight:(...args)=>ports.acknowledgeStorageV2CloudFlight(...args),
    backupSnapshotToComputer:(...args)=>ports.backupSnapshotToComputer(...args),
    pollSharedChecks:(...args)=>ports.pollSharedChecks?.(...args),refreshOrdersFinanceSummary:async()=>false,
  });
  t.after(()=>api.stopCloudPolling());
  return {api,model,session,tab,head,ports,events,authorize:value=>{authorized=value},
    edit(){model.state.notes[0].content='later';session.localGeneration++;head.seq++;head.pending=true},
    success:()=>events.some(([kind,...args])=>kind==='cloud'?args[0]==='synced':kind==='save'&&args[1]==='ok'),
  };
}

function stageFlight(f){
  f.edit();const flight={owner:f.head.base.owner,epoch:f.head.base.epoch,operationId:'F',baseRevision:5,startSeq:1,endSeq:1,generation:1,snapshot:f.ports.prepareKupaCloudState(f.model.state)};
  f.ports.materializeStorageV2CloudFlight=async()=>{f.head.flight=clone(flight);return clone(flight)};
  f.ports.supaRest=async()=>({ok:true,text:async()=>JSON.stringify({revision:6,state:clone(flight.snapshot)})});
  f.ports.acknowledgeStorageV2CloudFlight=async(_id,revision,state)=>{
    f.head.base={...f.head.base,revision,ackSeq:1,state:clone(state)};f.head.flight=null;f.head.pending=f.head.seq>1;
    return clone(f.head);
  };
  return flight;
}

test('Kupa no-flight completion cannot confirm a mutation committed during materialization',async t=>{
  const f=fixture(t),entered=gate(),release=gate();
  f.ports.materializeStorageV2CloudFlight=async()=>{entered.resolve();await release.promise;return null};
  const save=f.api.requestStorageV2CloudSave('');await entered.promise;f.edit();release.resolve();
  assert.equal(await save,false);assert.equal(f.success(),false);assert.equal(f.head.pending,true);assert.equal(f.model.state.notes[0].id,'N');
});

for(const loss of ['logout','leadership','owner','epoch','control','offline','protocol'])test(`Kupa no-flight completion rejects ${loss} during materialization`,async t=>{
  const f=fixture(t),entered=gate(),release=gate();
  f.ports.materializeStorageV2CloudFlight=async()=>{entered.resolve();await release.promise;return null};
  const save=f.api.requestStorageV2CloudSave('');await entered.promise;
  if(loss==='logout'){f.session.backendReady=false;f.authorize(false)}
  if(loss==='leadership')f.tab.primaryTab=false;
  if(loss==='owner')f.head.base.owner='B:kupa';
  if(loss==='epoch')f.head.base.epoch='other-epoch';
  if(loss==='control')f.head.control={retry:{lastErrorCode:'network'}};
  if(loss==='offline')navigator.onLine=false;
  if(loss==='protocol')f.session.storageProtocolBlocked=true;
  release.resolve();assert.equal(await save,false);assert.equal(f.success(),false);
});

test('Kupa a clean no-op save confirms the existing durable head without mutating it',async t=>{
  const f=fixture(t),before=clone(f.head);assert.equal(await f.api.requestStorageV2CloudSave(''),true);
  assert.equal(f.success(),true);assert.deepEqual(f.head,before);
});

for(const change of ['local-edit','logout','leadership','owner','epoch','retry'])test(`Kupa a committed flight cannot confirm stale success after ${change} during post-ACK backup`,async t=>{
  const f=fixture(t);stageFlight(f);const entered=gate(),release=gate();
  f.ports.backupSnapshotToComputer=async()=>{entered.resolve();await release.promise};
  const save=f.api.requestStorageV2CloudSave('');await entered.promise;
  assert.equal(f.head.base.ackSeq,1);assert.equal(f.success(),false);
  if(change==='local-edit')f.edit();
  if(change==='logout'){f.session.backendReady=false;f.authorize(false)}
  if(change==='leadership')f.tab.primaryTab=false;
  if(change==='owner')f.head.base.owner='B:kupa';
  if(change==='epoch')f.head.base.epoch='new-epoch';
  if(change==='retry')f.head.control={retry:{lastErrorCode:'network'}};
  release.resolve();assert.equal(await save,false);assert.equal(f.success(),false);
  assert.equal(f.model.state.notes[0].id,'N');assert.equal(f.head.base.ackSeq,1);
  if(change==='local-edit'){assert.equal(f.head.pending,true);assert.equal(f.head.seq,2)}
});

test('Kupa a committed unchanged flight can confirm synced after its backup',async t=>{
  const f=fixture(t);stageFlight(f);assert.equal(await f.api.requestStorageV2CloudSave(''),true);
  assert.equal(f.success(),true);assert.equal(f.head.base.ackSeq,1);assert.equal(f.session.dbRevision,6);
});

test('Kupa an edit during the final durable confirmation read invalidates its clean snapshot',async t=>{
  const f=fixture(t),entered=gate(),release=gate();let reads=0;
  f.ports.refreshStorageV2CloudState=async()=>{const observed=clone(f.head);if(++reads===3){entered.resolve();await release.promise}return observed};
  const save=f.api.requestStorageV2CloudSave('');await entered.promise;f.edit();release.resolve();
  assert.equal(await save,false);assert.equal(f.success(),false);assert.equal(f.head.pending,true);
});

test('Kupa failed final confirmation reports failure without changing a previously durable head',async t=>{
  const f=fixture(t),before=clone(f.head),reports=[];let reads=0;t.mock.method(console,'warn',(...args)=>reports.push(args));
  f.ports.refreshStorageV2CloudState=async()=>{if(++reads===3)throw new DOMException('injected read abort','AbortError');return clone(f.head)};
  assert.equal(await f.api.requestStorageV2CloudSave(''),false);assert.equal(f.success(),false);assert.deepEqual(f.head,before);
  assert.equal(f.events.at(-1)[1],'syncing');assert.equal(reports.length,1);
});

test('Kupa pending-poll completion revalidates Main after a Shared read',async t=>{
  const f=fixture(t);stageFlight(f);f.ports.pollSharedChecks=async()=>f.edit();
  assert.equal(await f.api.cloudPoll(),false);
  assert.equal(f.events.at(-1)[1],'syncing');assert.equal(f.head.pending,true);
});

test('Kupa a newer generation wakes its existing poll owner after the joined save settles',async t=>{
  const jobs=new Map();let next=0;t.mock.method(globalThis,'setTimeout',(run,delay)=>{jobs.set(++next,{run,delay});return next});t.mock.method(globalThis,'clearTimeout',id=>jobs.delete(id));
  const f=fixture(t),entered=gate(),release=gate(),rpcEntered=gate(),rpcRelease=gate();
  f.ports.materializeStorageV2CloudFlight=async()=>{entered.resolve();await release.promise;return null};
  f.api.startCloudPolling();assert.equal(jobs.size,1);
  const save=f.api.requestStorageV2CloudSave('');await entered.promise;stageFlight(f);
  const rpc=f.ports.supaRest;let calls=0;f.ports.supaRest=async(...args)=>{calls++;rpcEntered.resolve();await rpcRelease.promise;return rpc(...args)};
  release.resolve();assert.equal(await save,false);await rpcEntered.promise;
  assert.equal(f.success(),false);assert.equal(f.head.pending,true);assert.equal(calls,1);assert.equal(jobs.size,0);
  rpcRelease.resolve();assert.equal(await f.api.cloudPoll(),true);assert.equal(f.head.pending,false);assert.equal(f.success(),true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(jobs.size,1);f.api.stopCloudPolling();assert.equal(jobs.size,0);
});

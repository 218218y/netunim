import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncDocument as createOrdersSync} from '../netunim-orders/site/assets/js/sync/document.js';
import {createSyncDocument as createKupaSync} from '../netunim-kupa/site/assets/js/sync/document.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/composition/state-normalization.js';

const clone=structuredClone,noop=()=>{};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
function fixture(app,t){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator});
  const model={state:{notes:[{id:'N',content:'original'}],checks:[]}},tab={primaryTab:true},statuses=[],requests=[];
  const session={localGeneration:0,cloudRevision:7,dbRevision:7,financeRevision:0,connectionMode:'supabase',backendReady:true,serverInfo:{}};
  const access={enabled:true},head={seq:0,base:{revision:7,ackSeq:0,owner:app+':A',epoch:'E'},pending:false,flight:null,control:null};
  let project=(value=model.state)=>clone(value);
  if(app==='kupa'){
    const normalization=createStateNormalization({model});model.state=normalization.normalizeState({notes:model.state.notes});project=normalization.prepareKupaCloudState;
  }
  head.base.state=project(model.state);
  const ports={model,session,tab,files:{},checksSession:{},toast:noop,render:noop,
    refreshStorageV2CloudState:async()=>clone(head),storageV2PreparationActive:()=>false,
    setCloud:(...args)=>statuses.push(args),setCloudHeaderStatus:(...args)=>statuses.push(args),setSaveStatus:noop,
    prepareCloudState:project,prepareKupaCloudState:project,applyOrderCloudState:noop,applyKupaCloudState:noop,
    cloudEnabled:()=>access.enabled,cloudHasLocalWork:()=>head.pending||!!head.flight,
    sameOrderCloudData:(a,b)=>JSON.stringify(project(a))===JSON.stringify(project(b)),
    readCloudMeta:async()=>({revision:7}),readCloud:async()=>({revision:7,state:project(model.state)}),
    readSupabaseDocument:async()=>({revision:7,financeRevision:0,state:project(model.state)}),
    pollSharedChecks:async()=>{},refreshKupaReadout:async()=>false,refreshOrdersFinanceSummary:async()=>false,refreshCloudTimestamp:noop,
    storageV2CloudOutboxActive:()=>access.enabled,assertAccountOwner:()=>{if(!access.enabled)throw new Error('account owner changed')},
    writeStateToFolder:async()=>{},materializeStorageV2CloudFlight:async()=>{requests.push('materialize');return null},
  };
  const api=(app==='orders'?createOrdersSync:createKupaSync)({...ports,
    readCloudMeta:(...args)=>ports.readCloudMeta(...args),readCloud:(...args)=>ports.readCloud(...args),
    readSupabaseDocument:(...args)=>ports.readSupabaseDocument(...args),
    refreshStorageV2CloudState:(...args)=>ports.refreshStorageV2CloudState(...args),pollSharedChecks:(...args)=>ports.pollSharedChecks(...args),
  });
  return {api,model,session,tab,access,head,ports,statuses,requests,project,
    edit(){model.state.notes[0].content='later';session.localGeneration++;head.seq++;head.pending=true},
    synced:()=>statuses.some(status=>app==='orders'?status[1]==='synced':status[0]==='synced'),
  };
}

for(const path of ['meta','row'])test(`Orders ${path} fast path cannot confirm synced after an edit during GET`,async t=>{
  const f=fixture('orders',t),entered=deferred(),release=deferred();
  if(path==='row')f.ports.readCloudMeta=async()=>({revision:8});
  f.ports[path==='meta'?'readCloudMeta':'readCloud']=async()=>{entered.resolve();await release.promise;return {revision:7,state:f.project(f.model.state)}};
  const poll=f.api.cloudPoll();await entered.promise;f.edit();release.resolve();
  assert.equal(await poll,false);assert.equal(f.synced(),false);assert.equal(f.head.pending,true);assert.equal(f.model.state.notes[0].content,'later');
});

for(const app of ['orders','kupa'])for(const loss of ['leadership','account','network','control'])test(`${app} clean poll cannot confirm synced after ${loss} changes during GET`,async t=>{
  const f=fixture(app,t),entered=deferred(),release=deferred();
  f.ports[app==='orders'?'readCloudMeta':'readSupabaseDocument']=async()=>{entered.resolve();await release.promise;return {revision:7,financeRevision:0}};
  const poll=f.api.cloudPoll();await entered.promise;
  if(loss==='leadership')f.tab.primaryTab=false;
  else if(loss==='account')f.access.enabled=false;
  else if(loss==='network')navigator.onLine=false;
  else f.head.control={conflict:{kind:'concurrent-review'}};
  release.resolve();assert.equal(await poll,false);assert.equal(f.synced(),false);
});

for(const app of ['orders','kupa'])test(`${app} an edit during Shared polling cannot confirm Main synced at completion`,async t=>{
  const f=fixture(app,t),entered=deferred(),release=deferred();
  f.ports.pollSharedChecks=async()=>{entered.resolve();await release.promise};
  const poll=f.api.cloudPoll();await entered.promise;assert.equal(f.synced(),false);
  f.edit();release.resolve();assert.equal(await poll,false);assert.equal(f.synced(),false);assert.equal(f.head.pending,true);
});

for(const app of ['orders','kupa'])for(const change of ['owner','epoch','sequence','flight','retry'])test(`${app} ${change} during a clean GET invalidates its status evidence`,async t=>{
  const f=fixture(app,t),entered=deferred(),release=deferred();
  f.ports[app==='orders'?'readCloudMeta':'readSupabaseDocument']=async()=>{entered.resolve();await release.promise;return {revision:7,financeRevision:0}};
  const poll=f.api.cloudPoll();await entered.promise;
  if(change==='owner')f.head.base.owner='other-account';
  else if(change==='epoch')f.head.base.epoch='new-epoch';
  else if(change==='sequence'){f.head.seq++;f.head.base.ackSeq=f.head.seq}
  else if(change==='flight')f.head.flight={operationId:'unresolved'};
  else f.head.control={retry:{attempts:1}};
  release.resolve();assert.equal(await poll,false);assert.equal(f.synced(),false);
});

test('Orders an edit during the initial journal read invalidates the poll generation',async t=>{
  const f=fixture('orders',t),entered=deferred(),release=deferred();let reads=0;
  f.ports.refreshStorageV2CloudState=async()=>{if(!reads++){entered.resolve();await release.promise}return clone(f.head)};
  const poll=f.api.cloudPoll();await entered.promise;f.edit();release.resolve();
  assert.equal(await poll,false);assert.equal(f.synced(),false);assert.equal(f.requests.length,0);
});

for(const app of ['orders','kupa'])test(`${app} a clean scoped checkpoint can confirm synced without changing ACK or pending metadata`,async t=>{
  const f=fixture(app,t),before=clone(f.head);
  assert.equal(await f.api.cloudPoll(),true);assert.equal(f.synced(),true);assert.deepEqual(f.head,before);assert.equal(f.requests.length,0);
});

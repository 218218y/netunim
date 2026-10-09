import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCreditController} from '../netunim-kupa/site/assets/js/domains/credit/controller.js';
import {createDomainsBankController} from '../netunim-kupa/site/assets/js/domains/bank/controller.js';
import {createCreditPreferences} from '../netunim-kupa/site/assets/js/platform/credit-preferences.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
async function settle(){for(let i=0;i<40;i++)await Promise.resolve()}
function fixture(kind,t){
  const values=new Map(),jobs=new Map(),reports=[];let next=0,scope='account:A',attempts=0,claims=0,releases=0;
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  t.mock.method(globalThis,'setTimeout',(run,delay)=>{const id=++next;jobs.set(id,{run,delay});return id});t.mock.method(globalThis,'clearTimeout',id=>jobs.delete(id));
  t.mock.method(console,'error',(...args)=>reports.push(args));
  t.after(()=>{jobs.clear();if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator});
  const old='2020-01-01T00:00:00.000Z',model={state:{bank:{source:'hapoalim',bankSyncAt:old},creditSync:{version:3,syncedAt:old,profiles:[],errors:[]},checks:[]}};
  const session={backendReady:true,connectionMode:'supabase'},tab={primaryTab:true},status=deferred(),cloud=deferred(),writes=[];
  let leaseRead=null,statusReads=0;
  const ports={model,session,checksSession:{},captureOperation:()=>{const observed=scope;return ()=>{if(!scope||observed!==scope||!tab.primaryTab||!session.backendReady)throw Object.assign(new Error('fixture finance access changed'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})}},autoScope:()=>session.backendReady&&tab.primaryTab&&navigator.onLine!==false?scope:null,saveState:async(...args)=>{writes.push(args);return true},saveFinancePatch:async mutator=>({saved:true,row:{revision:2,state:mutator(model.state)}}),toast:()=>{},render:()=>{},modal:()=>{},armModalDraftGuard:()=>{},closeModal:()=>{},confirmDialog:async()=>true,
    sharedChecksHaveLocalWork:()=>false,syncSharedChecksFromCloud:async()=>true,sharedChecksObservedSequence:()=>0,
    refreshFinanceCloudSnapshot:()=>cloud.promise,
    claimFinanceSyncLease:async()=>{claims++;return leaseRead?leaseRead():{acquired:true,leaseName:kind,leaseToken:'L',fenceEpoch:1}},releaseFinanceSyncLease:async(_kind,_token,options)=>{options?.assertCurrent?.();releases++;return true},
    bridge:{getBridgeToken:()=> 'paired',autoEnabled:()=>values.get('bank-auto')!=='0',setAutoEnabled:on=>values.set('bank-auto',on?'1':'0'),autoAttemptDelayMs:()=>0,markAutoAttempt:()=>{},creditStatus:()=>{statusReads++;return status.promise},
      syncCreditCards:async()=>{attempts++;throw new Error('fixture provider attempt')},fetchBalance:async()=>{attempts++;throw new Error('fixture provider attempt')}},
  };
  ports.operationScope={capture:ports.captureOperation,captureRead:ports.captureOperation};
  if(kind==='credit')ports.preferences=createCreditPreferences();
  const api=(kind==='credit'?createDomainsCreditController:createDomainsBankController)(ports);
  return {api,ports,model,session,tab,values,jobs,reports,writes,scope:value=>{scope=value},lease:fn=>{leaseRead=fn},attempts:()=>attempts,claims:()=>claims,releases:()=>releases,statusReads:()=>statusReads,
    releaseStatus:()=>status.resolve({bridgeVersion:73,contractVersion:2,profiles:[{profileId:'P'}]}),releaseCloud:()=>cloud.resolve({verified:true,state:model.state})};
}

test('credit opt-out during Bridge status prevents a new issuer session',async t=>{
  const f=fixture('credit',t),pending=f.api.maybeAutoRefreshCreditSync();await settle();
  f.api.setCreditAutoRefresh(false);f.releaseCloud();f.releaseStatus();await pending;await settle();
  assert.equal(f.attempts(),0);assert.equal(f.claims(),0);assert.equal(f.jobs.size,0);
});
for(const kind of ['bank','credit'])test(`${kind} owner change during cloud preflight prevents lease and provider entry`,async t=>{
  const f=fixture(kind,t),pending=kind==='bank'?f.api.refreshBankBalance({auto:true}):f.api.refreshCreditSync({auto:true});await settle();
  f.scope('account:B');f.releaseCloud();f.releaseStatus();await pending;await settle();
  assert.equal(f.claims(),0);assert.equal(f.attempts(),0);
  assert.equal(f.jobs.size,0);
});
for(const kind of ['bank','credit'])test(`${kind} opt-out during cloud preflight prevents lease and provider entry`,async t=>{
  const f=fixture(kind,t),pending=kind==='bank'?f.api.refreshBankBalance({auto:true}):f.api.refreshCreditSync({auto:true});await settle();
  if(kind==='bank')f.api.setBankAutoRefresh(false);else f.api.setCreditAutoRefresh(false);
  f.releaseCloud();f.releaseStatus();await pending;await settle();assert.equal(f.claims(),0);assert.equal(f.attempts(),0);
});

for(const kind of ['bank','credit']){
  for(const [name,block] of [['offline',()=>{navigator.onLine=false}],['secondary tab',f=>{f.tab.primaryTab=false}],['logout',f=>{f.session.backendReady=false}],['missing owner',f=>f.scope(null)]])test(`${kind} ${name} during preflight preserves data without provider entry`,async t=>{
    const f=fixture(kind,t),before=structuredClone(f.model.state),pending=kind==='bank'?f.api.refreshBankBalance({auto:true}):f.api.refreshCreditSync({auto:true});await settle();block(f);
    f.releaseCloud();f.releaseStatus();await pending;assert.equal(f.claims(),0);assert.equal(f.attempts(),0);assert.deepEqual(f.model.state,before);assert.equal(f.writes.length,0);
  });
  test(`${kind} stopped timer delivery cannot launch an old callback`,async t=>{
    const f=fixture(kind,t);if(kind==='bank')f.api.startAutoSync();else f.api.setCreditAutoRefresh(true);
    assert.equal(f.jobs.size,1);const callback=[...f.jobs.values()][0].run;f.api.stopAutoSync();assert.equal(f.jobs.size,0);callback();await settle();
    assert.equal(f.statusReads(),0);assert.equal(f.claims(),0);assert.equal(f.attempts(),0);assert.equal(f.jobs.size,0);
  });
  test(`${kind} stopping a held lease releases only the acquired lease`,async t=>{
    const f=fixture(kind,t),held=deferred();f.lease(()=>held.promise);f.releaseCloud();f.releaseStatus();
    const pending=kind==='bank'?f.api.refreshBankBalance({auto:true}):f.api.refreshCreditSync({auto:true});await settle();assert.equal(f.claims(),1);
    f.api.stopAutoSync();held.resolve({acquired:true,leaseName:kind,leaseToken:'L',fenceEpoch:1});await pending;
    assert.equal(f.releases(),1);assert.equal(f.attempts(),0);assert.equal(f.jobs.size,0);
  });
  test(`${kind} owner change in the second cloud read prevents provider entry and defers the old lease to expiry`,async t=>{
    const f=fixture(kind,t);let reads=0;
    const create=kind==='bank'?createDomainsBankController:createDomainsCreditController;
    const api=create({...f.ports,refreshFinanceCloudSnapshot:async()=>{if(++reads===2)f.scope('account:B');return {verified:true,state:f.model.state}}});f.releaseStatus();
    await (kind==='bank'?api.refreshBankBalance({auto:true}):api.refreshCreditSync({auto:true}));assert.equal(f.claims(),1);assert.equal(f.releases(),0);assert.equal(f.attempts(),0);
    api.stopAutoSync();
  });
}

test('credit repeated foreground wakeups share one pending status and one automatic run',async t=>{
  const f=fixture('credit',t),one=f.api.startAutoSync(),two=f.api.maybeAutoRefreshCreditSync(),three=f.api.startAutoSync();
  assert.equal(one,two);assert.equal(two,three);await settle();assert.equal(f.statusReads(),1);
  f.api.stopAutoSync();f.releaseStatus();f.releaseCloud();await one;assert.equal(f.claims(),0);assert.equal(f.jobs.size,0);
  f.api.startAutoSync();await settle();assert.equal(f.claims(),1);assert.equal(f.attempts(),1);f.api.stopAutoSync();await settle();assert.equal(f.jobs.size,0);
});

test('stopping after credit provider entry lets the received result finish its existing durable path',async t=>{
  const f=fixture('credit',t),provider=deferred();f.releaseCloud();f.releaseStatus();
  f.ports.bridge.syncCreditCards=()=>provider.promise;
  const pending=f.api.refreshCreditSync({auto:true});await settle();assert.equal(f.claims(),1);f.api.stopAutoSync();
  provider.resolve({syncedAt:'2026-10-08T10:00:00Z',attemptedCount:1,profiles:[{profileId:'P',provider:'max',accounts:[]}],errors:[]});await pending;
  assert.equal(f.model.state.creditSync.syncedAt,'2026-10-08T10:00:00.000Z');assert.equal(f.writes.length,1);assert.equal(f.releases(),1);assert.equal(f.jobs.size,0);
});

test('manual credit refresh remains available with automatic preferences disabled',async t=>{
  const f=fixture('credit',t);f.api.setCreditAutoRefresh(false);f.releaseStatus();f.releaseCloud();await f.api.refreshCreditSync({auto:false});
  assert.equal(f.claims(),1);assert.equal(f.attempts(),1);assert.equal(f.jobs.size,0);
});

test('credit owner change does not silently adopt the new owner on a later page render',async t=>{
  const f=fixture('credit',t),pending=f.api.startAutoSync();await settle();f.scope('account:B');f.releaseStatus();f.releaseCloud();await pending;
  assert.equal(f.jobs.size,0);await f.api.maybeAutoRefreshCreditSync();assert.equal(f.claims(),0);assert.equal(f.jobs.size,0);
  await f.api.startAutoSync();assert.equal(f.claims(),1);f.api.stopAutoSync();
});

for(const kind of ['bank','credit'])test(`${kind} explicit automatic opt-in resumes a stopped owner`,t=>{
  const f=fixture(kind,t);f.api.stopAutoSync();f.scope('account:B');
  if(kind==='bank')f.api.setBankAutoRefresh(true);else f.api.setCreditAutoRefresh(true);
  assert.equal(f.jobs.size,1);f.api.stopAutoSync();assert.equal(f.jobs.size,0);
});

test('bank upgrade block owns no recurring timer and resumes after an eligible Bridge status',async t=>{
  const f=fixture('bank',t);let bridgeVersion=1;f.ports.bridge.status=async()=>({bridgeVersion,configured:true});
  await f.api.refreshBankBridgeStatus();f.api.startAutoSync();
  assert.equal(f.jobs.size,0);assert.equal(f.claims(),0);assert.equal(f.attempts(),0);
  bridgeVersion=73;await f.api.refreshBankBridgeStatus();f.api.maybeAutoRefreshBankBalance();
  assert.equal(f.jobs.size,1);f.api.stopAutoSync();
});

for(const kind of ['bank','credit'])test(`${kind} fresh data retains its established refresh interval`,t=>{
  const f=fixture(kind,t),now=Date.parse('2026-10-08T10:00:00Z');t.mock.method(Date,'now',()=>now);
  if(kind==='bank'){f.model.state.bank.bankSyncAt=new Date(now).toISOString();f.api.startAutoSync()}
  else{f.model.state.creditSync.syncedAt=new Date(now).toISOString();f.api.setCreditAutoRefresh(true)}
  assert.equal([...f.jobs.values()][0].delay,(kind==='bank'?4:24)*60*60*1000+250);assert.equal(f.attempts(),0);f.api.stopAutoSync();
});

for(const kind of ['bank','credit'])test(`${kind} automatic failure cooldown still controls its next deadline`,t=>{
  const f=fixture(kind,t),now=Date.parse('2026-10-08T10:00:00Z');t.mock.method(Date,'now',()=>now);
  if(kind==='bank'){f.ports.bridge.autoAttemptDelayMs=()=>45_000;f.api.startAutoSync()}
  else{f.values.set('netunim_kupa_credit_auto_attempt_v1',String(now));f.api.setCreditAutoRefresh(true)}
  assert.equal([...f.jobs.values()][0].delay,kind==='bank'?45_250:24*60*60*1000+250);assert.equal(f.attempts(),0);f.api.stopAutoSync();
});

for(const [name,create] of [['bank',createDomainsBankController],['credit',createDomainsCreditController]])test(`${name} missing automatic access port rejects construction`,()=>{
  assert.throws(()=>create({}),new RegExp(name+'_auto_scope_required'));
});

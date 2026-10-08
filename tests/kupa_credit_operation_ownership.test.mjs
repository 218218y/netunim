import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsCreditController} from '../netunim-kupa/site/assets/js/domains/credit/controller.js';
import {createCloudTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {createFinanceOperationScope,createFinanceManualQueue,startFinanceLeaseHeartbeat} from '../shared/finance-fence.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const result={syncedAt:'2026-10-08T10:00:00Z',attemptedCount:1,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'card',txns:[{id:'provider-transaction',date:'2026-10-08',processedDate:'2026-10-08',status:'completed',chargedAmount:-12,chargedCurrency:'ILS'}]}]}],errors:[]};
const stale=()=>Object.assign(new Error('finance operation ownership changed'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});
function fixture(t){
  const values=new Map();t.mock.method(globalThis,'setTimeout',()=>1);t.mock.method(globalThis,'clearTimeout',()=>{});
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)}});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage});t.mock.method(console,'error',()=>{});
  let owner='A',epoch=1,primary=true,saves=0,patches=0,releases=0;
  const model={state:{creditSync:{version:4,syncedAt:'2020-01-01T00:00:00Z',profiles:[],errors:[]}}},before=structuredClone(model.state),provider=deferred(),entered=deferred();
  const captureOperation=createFinanceOperationScope({readAccess:()=>({account:{owner,epoch},connectionMode:'supabase',storageOwner:owner,writable:primary})}).capture;
  const ports={model,autoScope:()=>owner?`owner:${owner}`:null,captureOperation,toast:()=>{},render:()=>{},saveState:async()=>{saves++},
    bridge:{getBridgeToken:()=> 'fixture',creditStatus:async()=>({bridgeVersion:73,contractVersion:2,profiles:[{profileId:'P'}]}),syncCreditCards:()=>{entered.resolve();return provider.promise}},
    refreshFinanceCloudSnapshot:async()=>({verified:true,state:model.state}),claimFinanceSyncLease:async()=>({acquired:true,leaseName:'credit',leaseToken:'L',fenceEpoch:1}),
    releaseFinanceSyncLease:async(_kind,_token,options)=>{options?.assertCurrent?.();releases++},
    saveFinancePatch:async mutator=>{patches++;return {saved:true,row:{state:mutator({creditSync:model.state.creditSync})}}},
  };
  return {ports,model,before,provider,entered,create:()=>createDomainsCreditController(ports),change:()=>{owner='B';epoch++},logout:()=>{owner=null;epoch++},relogin:()=>{epoch++},secondary:()=>{primary=false},captureOperation,
    counts:()=>({saves,patches,releases})};
}

for(const [name,change] of [['account change',f=>f.change()],['logout',f=>f.logout()],['same-account relogin',f=>f.relogin()],['leadership loss',f=>f.secondary()]]){
  for(const auto of [false,true])test(`credit ${name} after ${auto?'automatic':'manual'} provider entry preserves existing state`,async t=>{
    const f=fixture(t),api=f.create(),pending=api.refreshCreditSync({auto});await f.entered.promise;change(f);f.provider.resolve(result);await pending;
    assert.deepEqual(f.model.state,f.before);assert.equal(f.counts().patches,0);assert.equal(f.counts().saves,0);assert.equal(f.counts().releases,0);
    assert.match(api.creditSyncUiState().error,/ההתחברות/);api.stopAutoSync();
  });
}
test('credit structured provider failure after logout cannot persist former-owner diagnostics',async t=>{
  const f=fixture(t),api=f.create(),pending=api.refreshCreditSync();await f.entered.promise;f.logout();f.provider.reject(Object.assign(new Error('issuer failed'),{creditErrors:[{profileId:'P',message:'private former-owner diagnostic'}]}));await pending;
  assert.deepEqual(f.model.state,f.before);assert.equal(f.counts().patches,0);api.stopAutoSync();
});
test('credit failed publication keeps last successful projection unchanged',async t=>{
  const f=fixture(t);f.ports.saveFinancePatch=async()=>{throw new Error('offline before publication')};const api=f.create(),pending=api.refreshCreditSync();await f.entered.promise;f.provider.resolve(result);await pending;
  assert.deepEqual(f.model.state,f.before);assert.equal(f.counts().saves,0);assert.match(api.creditSyncUiState().error,/offline/);api.stopAutoSync();
});
test('credit owner change while cloud publication completes cannot publish into the new model',async t=>{
  const f=fixture(t),saving=deferred(),saved=deferred();f.ports.saveFinancePatch=async mutator=>{const next=mutator({creditSync:f.model.state.creditSync});saving.resolve();await saved.promise;return {saved:true,row:{state:next}}};
  const api=f.create(),pending=api.refreshCreditSync();await f.entered.promise;f.provider.resolve(result);await saving.promise;
  f.change();f.model.state={creditSync:{version:4,profiles:[{profileId:'new-owner'}],errors:[]}};const nextOwner=structuredClone(f.model.state);saved.resolve();await pending;
  assert.deepEqual(f.model.state,nextOwner);assert.equal(f.counts().saves,0);api.stopAutoSync();
});
test('credit ordinary scheduler stop still drains a received result under the same owner',async t=>{
  const f=fixture(t),api=f.create(),pending=api.refreshCreditSync({auto:true});await f.entered.promise;api.stopAutoSync();f.provider.resolve(result);await pending;
  assert.equal(f.model.state.creditSync.profiles[0].profileId,'P');assert.equal(f.counts().patches,1);assert.equal(f.counts().saves,1);assert.equal(f.counts().releases,1);
});
test('manual credit settings do not publish a former-owner successful response',async t=>{
  const f=fixture(t),saving=deferred(),saved=deferred();f.ports.saveFinancePatch=async mutator=>{const next=mutator({creditSync:f.model.state.creditSync});saving.resolve();await saved.promise;return {saved:true,row:{state:next}}};
  const api=f.create(),pending=api.saveCreditCardOrder(null);await saving.promise;f.relogin();saved.resolve();await assert.rejects(pending,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.deepEqual(f.model.state,f.before);assert.equal(f.counts().saves,0);api.stopAutoSync();
});
test('finance publication guard fences rebase and HTTP send after a held read',async()=>{
  const read=deferred(),entered=deferred(),requests=[];let valid=true;const assertCurrent=()=>{if(!valid)throw stale()};
  const transport=createCloudTransport({supaRest:async(path,options)=>{options.assertRequestScope?.();requests.push(path);if(options.method==='GET'){entered.resolve();await read.promise;return {ok:true,json:async()=>[{revision:1,state:{}}]}}return {ok:true,text:async()=>JSON.stringify({revision:2,state:{}})}}});
  const pending=transport.saveFinancePatch(state=>({...state,creditSync:result}),{leaseName:'credit',leaseToken:'L',fenceEpoch:1,assertCurrent});await entered.promise;valid=false;read.resolve();
  await assert.rejects(pending,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.equal(requests.length,1);
});

test('finance operation requires a writable matching owner and preserves ordinary token refresh',()=>{
  let access={account:{owner:'A',epoch:1},connectionMode:'supabase',storageOwner:'A',writable:true};
  const scope=createFinanceOperationScope({readAccess:()=>access}),current=scope.capture();current();
  access={...access,account:{owner:'A',epoch:1},online:false};current();
  for(const value of [{...access,writable:false},{...access,storageOwner:'B'},{...access,account:{owner:'A',epoch:2}},{...access,account:{owner:null,epoch:2}},{...access,connectionMode:'local'}]){
    const before=access;access=value;assert.throws(current,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});access=before;
  }
  access={account:{owner:null,epoch:1},connectionMode:'local',storageOwner:'local',writable:true};scope.capture()();
});
test('queued manual edit cannot acquire a lease after its login changed',async()=>{
  const gate=deferred();let valid=true,claims=0;const assertCurrent=()=>{if(!valid)throw stale()};
  const queue=createFinanceManualQueue({claim:async()=>{claims++;return {acquired:true}},release:async()=>{},createToken:()=> 'fixture'});
  const first=queue(()=>gate.promise),second=queue(()=>assert.fail('former-owner edit ran'),{assertCurrent});await Promise.resolve();valid=false;gate.resolve();await first;
  await assert.rejects(second,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.equal(claims,1);
});
test('lease heartbeat cannot renew with former authorization or run after stop',async()=>{
  let tick,valid=true,claims=0;const assertCurrent=()=>{if(!valid)throw stale()};
  const heartbeat=startFinanceLeaseHeartbeat({leaseName:'credit',leaseToken:'L',fenceEpoch:1,assertCurrent},async()=>{claims++;return {acquired:true,fenceEpoch:1}},{setTimer:fn=>{tick=fn;return 1},clearTimer:()=>{}});
  valid=false;await tick();assert.equal(claims,0);assert.throws(()=>heartbeat.assertCurrent(),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});
  valid=true;heartbeat.stop();await tick();assert.equal(claims,0);
});

for(const serverCommitted of [false,true])test(`credit recovery after ${serverCommitted?'lost commit response':'offline publication'} preserves transaction identity`,async t=>{
  const f=fixture(t);let fail=true,remote={creditSync:f.model.state.creditSync};
  f.ports.saveFinancePatch=async mutator=>{const next=mutator(structuredClone(remote));if(!fail||serverCommitted)remote=next;if(fail)throw new Error('fixture lost response');return {saved:true,row:{state:remote}}};
  const api=f.create(),first=api.refreshCreditSync();await f.entered.promise;f.provider.resolve(result);await first;
  assert.deepEqual(f.model.state,f.before);assert.equal(f.counts().saves,0);fail=false;await api.refreshCreditSync();
  const txns=f.model.state.creditSync.profiles[0].accounts[0].txns;assert.equal(txns.length,1);assert.equal(txns[0].id,'provider-transaction');assert.equal(txns[0].chargedAmount,-12);
  assert.deepEqual(f.model.state.creditSync,remote.creditSync);assert.equal(f.counts().saves,1);api.stopAutoSync();
});

test('credit no-op save cannot publish or clear the previous data',async t=>{
  const f=fixture(t);f.ports.saveFinancePatch=async()=>({saved:false});const api=f.create(),pending=api.refreshCreditSync();await f.entered.promise;f.provider.resolve(result);await pending;
  assert.deepEqual(f.model.state,f.before);assert.equal(f.counts().saves,0);assert.match(api.creditSyncUiState().error,/לא נשמרו/);api.stopAutoSync();
});

test('credit rejects construction without an operation authorization port',()=>{
  assert.throws(()=>createDomainsCreditController({autoScope:()=> 'A'}),/credit_operation_scope_required/);
});

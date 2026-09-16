import test from 'node:test';
import assert from 'node:assert/strict';
import {createFinanceManualQueue} from '../shared/finance-fence.js';
import {applyCreditCardOrderData,creditOrderCardsData} from '../shared/credit-card-order.js';
import {createDomainsCreditController} from '../netunim-kupa/site/assets/js/domains/credit/controller.js';
import {createDomainsFinanceController} from '../netunim-orders/site/assets/js/domains/finance/controller.js';

const fixture=()=>({version:4,profiles:[{profileId:'p',provider:'max',accounts:[{accountNumber:'a',txns:[{id:'old',date:'2026-09-01'}]},{accountNumber:'b',txns:[]}]}],cardMappings:{'p:a':{included:true,cardName:'א',sortOrder:1},'p:b':{included:true,cardName:'ב',sortOrder:2}}});

test('manual settings queue waits for another sync, serializes edits and releases only its own lease',async()=>{
  const events=[];let attempts=0,token=0,active=false;
  const queue=createFinanceManualQueue({createToken:()=>`manual-${++token}`,claim:async(_,key)=>{events.push(`claim:${key}`);if(++attempts===1)return {acquired:false};assert.equal(active,false);active=true;return {acquired:true,leaseToken:key}},release:async(_,key)=>{events.push(`release:${key}`);active=false},wait:async()=>events.push('wait')});
  const values=await Promise.all([queue(async lease=>{events.push(`save:${lease.leaseToken}`);return 1}),queue(async lease=>{events.push(`save:${lease.leaseToken}`);return 2})]);
  assert.deepEqual(values,[1,2]);assert.deepEqual(events,['claim:manual-1','wait','claim:manual-1','save:manual-1','release:manual-1','claim:manual-2','save:manual-2','release:manual-2']);
});

test('persistent lease contention never mutates or releases another owner and a retry recovers',async()=>{
  let busy=true,saves=0,releases=0;
  const queue=createFinanceManualQueue({createToken:()=> 'manual',claim:async()=>({acquired:!busy}),release:async()=>releases++,wait:async()=>{},maxWaitMs:2,retryMs:1});
  await assert.rejects(queue(async()=>saves++),{code:'finance_sync_lease_busy'});
  assert.equal(saves,0);assert.equal(releases,0);busy=false;await queue(async()=>saves++);assert.equal(saves,1);assert.equal(releases,1);
});

test('lease cleanup failure does not turn a confirmed save into a failed save',async()=>{
  const errors=[];const queue=createFinanceManualQueue({createToken:()=> 'manual',claim:async()=>({acquired:true}),release:async()=>{throw new Error('network')},onReleaseError:error=>errors.push(error.message)});
  assert.equal(await queue(async()=>true),true);assert.deepEqual(errors,['network']);
});

test('alphabetical reset clears every stored rank, while reorder preserves remote mappings and transactions',()=>{
  const sync=fixture();sync.cardMappings['removed:card']={sortOrder:1,hidden:true};const before=structuredClone(sync);
  const reordered=applyCreditCardOrderData(sync,['p:b','p:a']);assert.deepEqual(creditOrderCardsData(reordered).map(row=>row.key),['p:b','p:a']);
  assert.deepEqual(reordered.profiles,sync.profiles);assert.equal(reordered.cardMappings['p:a'].included,true);
  const reset=applyCreditCardOrderData(reordered,null);assert.ok(Object.values(reset.cardMappings).every(mapping=>mapping.sortOrder===null));assert.deepEqual(creditOrderCardsData(reset).map(row=>row.key),['p:a','p:b']);assert.deepEqual(sync,before);
});

test('Kupa settings commit only after cloud confirmation and rebase on fresh issuer data',async()=>{
  const model={state:{creditSync:fixture()}},before=structuredClone(model.state),messages=[];let fail=true,localSaves=0;
  const fresh=fixture();fresh.profiles[0].accounts[0].txns=[{id:'remote-new',date:'2026-09-16'}];fresh.cardMappings['p:a'].hidden=true;
  const controller=createDomainsCreditController({model,saveState:async()=>localSaves++,toast:value=>messages.push(value),render:()=>{},saveFinancePatch:async mutator=>{
    if(fail)throw Object.assign(new Error('busy'),{code:'finance_sync_lease_busy'});
    const next=mutator({creditSync:structuredClone(fresh),bank:{balance:123}});assert.equal(next.bank.balance,123);
    assert.deepEqual(model.state,before,'nothing is changed before the server confirms');return {saved:true,row:{state:next}};
  }});
  assert.equal(await controller.setCreditCardMapping('p','a','sortOrder',''),false);assert.deepEqual(model.state,before);assert.equal(localSaves,0);
  await assert.rejects(controller.saveCreditCardOrder(null),/busy/);assert.deepEqual(model.state,before);
  fail=false;assert.equal(await controller.saveCreditCardOrder(null),true);assert.equal(localSaves,1);
  assert.equal(model.state.creditSync.cardMappings['p:a'].sortOrder,null);assert.equal(model.state.creditSync.cardMappings['p:a'].hidden,true);assert.equal(model.state.creditSync.profiles[0].accounts[0].txns[0].id,'remote-new');
});

test('Orders saves card order once, preserves fresh financial data and leaves sync status alone on failure',async()=>{
  let row={revision:5,state:{bank:{balance:123},creditSync:fixture()}},writes=0,fail=false;const checksSession={kupaCloudReadState:structuredClone(row.state),checksBankEvents:[]};
  const controller=createDomainsFinanceController({tab:{primaryTab:true},checksSession,bridge:{getBridgeToken:()=>'',bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,creditAutoMode:()=> 'daily'},loadSession:()=>({}),toast:()=>{},readFinanceSyncDocument:async()=>structuredClone(row),claimFinanceSyncLease:async()=>({acquired:true,leaseToken:'manual',leaseName:'credit',fenceEpoch:1}),releaseFinanceSyncLease:async()=>true,refreshKupaReadout:async()=>{checksSession.kupaCloudReadState=structuredClone(row.state)},rpcSaveFinanceSync:async(state,revision)=>{if(fail)throw new Error('network failed');assert.equal(revision,row.revision);writes++;row={revision:revision+1,state};return {r:{ok:true},row}}});
  row.state.creditSync.profiles[0].accounts[0].txns=[{id:'fresh',date:'2026-09-16'}];
  assert.equal(await controller.saveCreditCardOrder(['p:b','p:a']),true);assert.equal(writes,1);assert.equal(row.state.bank.balance,123);assert.equal(row.state.creditSync.profiles[0].accounts[0].txns[0].id,'fresh');
  fail=true;const saved=structuredClone(row);assert.equal(await controller.setCreditCardMapping('p','a','sortOrder',''),false);assert.deepEqual(row,saved);assert.equal(controller.snapshot().creditError,'');
  fail=false;await controller.saveCreditCardOrder(null);assert.equal(row.state.creditSync.cardMappings['p:a'].sortOrder,null);
});

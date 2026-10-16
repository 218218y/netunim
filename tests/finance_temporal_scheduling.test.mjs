import test from 'node:test';
import assert from 'node:assert/strict';
import {financeRefreshDelayMs,financeAttemptDelayMs,CREDIT_AUTO_INTERVAL_MS} from '../shared/finance-refresh-policy.js';
import {createOrdersFinanceAutomation} from '../netunim-orders/site/assets/js/domains/finance/automation.js';
import {createFinanceBridgeIntegration} from '../netunim-orders/site/assets/js/integrations/bank-bridge.js';
import {createBankBridgeIntegration} from '../netunim-kupa/site/assets/js/integrations/bank-bridge.js';

const now=Date.parse('2026-10-16T10:00:00Z'),far='2099-01-01T00:00:00Z';
test('freshness scheduling uses the same observation admission as the due decision',()=>{
  for(const stamp of [far,'2026-02-30T10:00:00Z','not-a-time',null])assert.equal(financeRefreshDelayMs(stamp,CREDIT_AUTO_INTERVAL_MS,now),0);
  assert.equal(financeRefreshDelayMs(new Date(now).toISOString(),CREDIT_AUTO_INTERVAL_MS,now),CREDIT_AUTO_INTERVAL_MS);
  assert.equal(financeAttemptDelayMs(Date.parse(far),CREDIT_AUTO_INTERVAL_MS,now),0);
  assert.equal(financeAttemptDelayMs(now,CREDIT_AUTO_INTERVAL_MS,now),CREDIT_AUTO_INTERVAL_MS);
  assert.equal(financeAttemptDelayMs(now+300001,CREDIT_AUTO_INTERVAL_MS,now),0);
});
test('Orders actual timer scheduling never trusts future syncedAt for either resource',t=>{
  t.mock.method(Date,'now',()=>now);
  const timers=[],owner=createOrdersFinanceAutomation({
    access:{primary:()=>true,authenticated:()=>true,online:()=>true,busy:()=>false,capture:()=>()=>{}},
    preferences:{getBridgeToken:()=> 'paired',bankAutoEnabled:()=>true,creditAutoEnabled:()=>true,creditAutoMode:()=> 'smart'},
    readLastSyncAt:()=>far,commands:{bank:async()=>assert.fail('scheduled only'),credit:async()=>assert.fail('scheduled only')},
    timers:{setTimeout:(run,delay)=>{timers.push({run,delay});return timers.length},clearTimeout:()=>{}},
  });
  owner.startAutoSync();assert.deepEqual(timers.map(row=>row.delay),[1000,1000]);owner.stopAutoSync();
});
for(const [name,create,keys] of [
  ['Kupa',createBankBridgeIntegration,['netunim_kupa_bank_auto_attempt_v1']],
  ['Orders',createFinanceBridgeIntegration,['netunim_orders_bank_auto_attempt_v1','netunim_orders_credit_auto_attempt_v1']],
])test(name+' local attempt clocks recover after a corrected clock without erasing stored evidence',()=>{
  const values=new Map(keys.map(key=>[key,String(Date.parse(far))]));
  const platform={preferences:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},clock:{now:()=>now},timers:{setTimeout:()=>assert.fail('no timer'),clearTimeout:()=>{}},fetchRequest:()=>assert.fail('no provider'),createAbortController:()=>new AbortController()};
  const api=create({platform});
  for(const prefix of name==='Kupa'?['auto']:['bank','credit']) {
    const delay=api[prefix==='auto'?'autoAttemptDelayMs':prefix+'AttemptDelayMs'];
    const ready=api[prefix==='auto'?'autoAttemptReady':prefix+'AttemptReady'];
    assert.equal(delay(),0);assert.equal(ready(),true);
  }
  for(const key of keys)assert.equal(values.get(key),String(Date.parse(far)));
});

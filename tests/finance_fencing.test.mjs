import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport as ordersTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createCloudTransport as kupaTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';
for(const [name,create] of [['orders',ordersTransport],['kupa',kupaTransport]])test(`${name} publication carries the captured lease fence`,async()=>{
 const requests=[],send=async(path,options)=>{
  const body=JSON.parse(options.body);requests.push({path,body});
  const result=path.includes('/sync_bank_transactions_snapshot')?
   [{inserted_count:0,updated_count:0,total_count:0,missing_count:0,active_missing_count:0,snapshot_stored:body.p_complete,baseline_created:false}]:
   {finance_revision:2,kupa_revision:2,acquired:true,lease_token:'A',fence_epoch:100,leased_until:'2030-01-01T00:00:00Z'};
  return {ok:true,text:async()=>JSON.stringify(result)};
 };
 const api=create({supaFetch:send,supaRest:send}),lease=await api.claimFinanceSyncLease('bank','A');assert.equal(lease.fenceEpoch,100);assert.equal(lease.leaseToken,'A');
 await api.saveBankSyncSnapshot({},'watermark',3,lease);await api.syncBankTransactionsSnapshot('account','business',[],{snapshotAt:'2026-09-01',lease});await api.rpcSaveFinanceSync({},1,'op',{},lease);
 for(const r of requests.slice(1)){assert.equal(r.body.p_lease_token,'A');assert.equal(r.body.p_fence_epoch,100);assert.equal(r.body.p_lease_name,'bank')}
});
import {startFinanceLeaseHeartbeat} from '../shared/finance-lease-heartbeat.js';
test('heartbeat renews at TTL/3 and never adopts a takeover epoch',async()=>{
 let tick,delay,calls=0;const lease={acquired:true,leaseName:'credit',leaseToken:'A',fenceEpoch:100,assertCurrent:()=>{}},heartbeat=startFinanceLeaseHeartbeat(lease,async()=>({...lease,fenceEpoch:++calls===1?100:101}),{ttlSeconds:60,setTimer:(fn,ms)=>{tick=fn;delay=ms;return 1},clearTimer:()=>{tick=null}});
 assert.equal(delay,20000);await tick();heartbeat.assertCurrent();await tick();assert.throws(()=>heartbeat.assertCurrent(),/stale_finance_sync_fence/);assert.equal(lease.fenceEpoch,100);await heartbeat.stop();await tick();assert.equal(calls,2);
});

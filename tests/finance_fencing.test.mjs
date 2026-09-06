import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport as ordersTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createCloudTransport as kupaTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';
for(const [name,create] of [['orders',ordersTransport],['kupa',kupaTransport]])test(`${name} publication carries the captured lease fence`,async()=>{
 const requests=[],send=async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});return {ok:true,text:async()=>JSON.stringify({acquired:true,lease_token:'A',fence_epoch:100,leased_until:'2030-01-01'})}};
 const api=create({supaFetch:send,supaRest:send}),lease=await api.claimFinanceSyncLease('bank','A');assert.equal(lease.fenceEpoch,100);assert.equal(lease.leaseToken,'A');
 await api.saveBankSyncSnapshot({},'watermark',3,lease);await api.syncBankTransactionsSnapshot('account','business',[],{snapshotAt:'2026-09-01',lease});await api.rpcSaveFinanceSync({},1,'op',{},lease);
 for(const r of requests.slice(1)){assert.equal(r.body.p_lease_token,'A');assert.equal(r.body.p_fence_epoch,100);assert.equal(r.body.p_lease_name,'bank')}
});
import {startFinanceLeaseHeartbeat} from '../shared/finance-fence.js';
test('heartbeat renews at TTL/3 and never adopts a takeover epoch',async()=>{
 let tick,delay,calls=0;const lease={leaseName:'credit',leaseToken:'A',fenceEpoch:100},heartbeat=startFinanceLeaseHeartbeat(lease,async()=>({acquired:true,fenceEpoch:++calls===1?100:101}),{ttlSeconds:60,setTimer:(fn,ms)=>{tick=fn;delay=ms;return 1},clearTimer:()=>{tick=null}});
 assert.equal(delay,20000);await tick();heartbeat.assertCurrent();await tick();assert.throws(()=>heartbeat.assertCurrent(),/stale_finance_sync_fence/);assert.equal(lease.fenceEpoch,100);heartbeat.stop();assert.equal(tick,null);
});

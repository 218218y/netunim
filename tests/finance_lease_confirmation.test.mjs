import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport as kupaTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {createCloudTransport as ordersTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {startFinanceLeaseHeartbeat,createFinanceManualQueue} from '../shared/finance-fence.js';

const granted={acquired:true,lease_token:'requested-token',fence_epoch:7,leased_until:'2030-01-01T00:00:00+00:00'};
const invalid=[
  ['missing fence',{acquired:true}],
  ['missing token',{...granted,lease_token:undefined}],
  ['foreign granted token',{...granted,lease_token:'another-operation'}],
  ['null fence',{...granted,fence_epoch:null}],
  ['zero fence',{...granted,fence_epoch:0}],
  ['fractional fence',{...granted,fence_epoch:1.5}],
  ['unsafe fence',{...granted,fence_epoch:Number.MAX_SAFE_INTEGER+1}],
  ['boolean fence',{...granted,fence_epoch:true}],
  ['ambiguous granted flag',{...granted,acquired:'true'}],
  ['missing deadline',{...granted,leased_until:undefined}],
  ['invalid deadline',{...granted,leased_until:'not-a-time'}],
  ['multiple rows',[granted,granted]],
  ['null body',null],
];
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
function fixture(create,body){const send=async()=>new Response(typeof body==='string'?body:JSON.stringify(body));return create({supaFetch:send,supaRest:send})}
const invalidReceipt=error=>error.code==='FINANCE_LEASE_RECEIPT_INVALID'&&error.kind==='confirmation_unknown'&&error.retryable===false;

for(const [site,create] of [['kupa',kupaTransport],['orders',ordersTransport]]){
  for(const [name,body] of invalid)test(`${site} lease rejects ${name} before authorizing provider work`,async()=>{
    await assert.rejects(fixture(create,body).claimFinanceSyncLease('credit','requested-token'),invalidReceipt);
  });
  test(`${site} invalid JSON is unknown confirmation, not lease contention`,async()=>{
    await assert.rejects(fixture(create,'{broken').claimFinanceSyncLease('bank','requested-token'),invalidReceipt);
  });
  test(`${site} valid grants and foreign-owner refusals retain SQL semantics`,async()=>{
    for(const acquired of [true,false]){
      const row={...granted,acquired,lease_token:acquired?'requested-token':'other-device',fence_epoch:'7'};
      const receipt=await fixture(create,[row]).claimFinanceSyncLease('bank','requested-token');
      assert.deepEqual(receipt,{acquired,leaseName:'bank',leaseToken:row.lease_token,fenceEpoch:7,leasedUntil:row.leased_until});
      assert.ok(Object.isFrozen(receipt));
    }
  });
  test(`${site} logout during response body cannot return a grant`,async()=>{
    const held=deferred(),entered=deferred();let live=true;
    const assertCurrent=()=>{if(!live)throw Object.assign(Error('former account'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})};
    const send=async()=>({ok:true,text:async()=>{entered.resolve();return held.promise}});
    const api=create({supaFetch:send,supaRest:send});
    const claim=api.claimFinanceSyncLease('credit','requested-token',{assertCurrent});
    await entered.promise;live=false;held.resolve(JSON.stringify(granted));
    await assert.rejects(claim,{code:'FINANCE_OPERATION_SCOPE_CHANGED'});
  });
  test(`${site} malformed renewal fences the running operation and stops scheduling`,async()=>{
    const api=fixture(create,{...granted,lease_token:'different-renewal-token'});let tick,scheduled=0;
    const lease={leaseName:'credit',leaseToken:'requested-token',fenceEpoch:7};
    const heartbeat=startFinanceLeaseHeartbeat(lease,api.claimFinanceSyncLease,{setTimer:fn=>{tick=fn;scheduled++;return scheduled},clearTimer:()=>{}});
    await tick();assert.throws(()=>heartbeat.assertCurrent(),invalidReceipt);
    assert.equal(scheduled,1);assert.equal(lease.leaseToken,'requested-token');assert.equal(lease.fenceEpoch,7);heartbeat.stop();
  });
  test(`${site} manual queue does not blindly wait/retry/release an unknown grant`,async()=>{
    const api=fixture(create,null);let work=0,wait=0,release=0;
    const queue=createFinanceManualQueue({claim:api.claimFinanceSyncLease,release:async()=>release++,createToken:()=> 'requested-token',wait:async()=>wait++});
    await assert.rejects(queue(async()=>work++),invalidReceipt);
    assert.deepEqual({work,wait,release},{work:0,wait:0,release:0});
  });
}

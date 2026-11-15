import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport as kupa} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {createCloudTransport as orders} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createCreditPublication} from '../netunim-kupa/site/assets/js/domains/credit/publication.js';
import {createCreditSettingsCommands} from '../netunim-orders/site/assets/js/domains/finance/credit-settings-commands.js';
for(const [name,create] of [['kupa',kupa],['orders',orders]])test(name+' confirmed resets use the backed-up RPC; normal sync cannot acquire reset authority',async()=>{
  const calls=[],send=async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return new Response('[]')};
  const api=create({supaRest:send,supaFetch:send}),state={creditSync:{version:4,profiles:[]}},lease={leaseName:'credit',leaseToken:'token',fenceEpoch:7};
  await api.rpcSaveFinanceSync(state,5,'normal',{},lease);
  await api.rpcSaveFinanceSync(state,5,'confirmed',{creditReset:true},lease);
  assert.match(calls[0].path,/save_finance_sync_document_v6$/);
  assert.match(calls[1].path,/reset_finance_credit_with_backup$/);
  assert.deepEqual(calls[1].body.p_credit_sync,state.creditSync);
  assert.equal(calls[1].body.p_lease_token,'token');assert.equal(calls[1].body.p_fence_epoch,7);
  assert.equal(calls[1].body.p_state,undefined);
});
test('publication forwards explicit reset intent while ordinary settings remain ordinary writes',async()=>{
  const options=[],guard=()=>{};
  const api=createCreditPublication({commit:async(mutate,lease,scope)=>{options.push(scope);return {saved:true,row:{revision:options.length,state:mutate({creditSync:{profiles:[]}})}}},publish:guard,checkpoint:async()=>true,read:async()=>({verified:true,state:{}})});
  await api.commit(state=>state,'normal',null,guard,guard);
  await api.commit(state=>state,'reset',null,guard,guard,true);
  assert.equal(options[0].creditReset,undefined);assert.equal(options[1].creditReset,true);
});
test('Orders explicit reset command carries reset authority through its Finance command port',async()=>{
  const scopes=[],guard=()=>{};
  const api=createCreditSettingsCommands({local:{},operationScope:{capture:()=>guard},
    connections:{queries:{supported:()=>true,refreshStatus:async()=>({}),capture:()=>guard,snapshot:()=>({status:{}})},commands:{resetProfiles:async()=>{}}},
    mutateFinanceCloud:async(mutate,lease,options)=>{mutate({});scopes.push(options);return {}},
    automation:{setCreditAutoEnabled:guard,setCreditAutoMode:guard,scheduleCreditAuto:guard,preferenceState:()=>({})},toast:guard});
  assert.equal(await api.resetCreditSync(),true);assert.equal(scopes[0].creditReset,true);
});

import {createFinanceBrowserEffects} from '../shared/finance-browser-effects.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {createOrdersFinanceControllerFixture as createDomainsFinanceController} from './orders_finance_controller_fixture.mjs';
import {readFinanceWriteReceipt} from '../shared/finance-write-receipt.js';

const initial=()=>({bank:{currentBalance:100},creditSync:{profiles:[],cardMappings:{}},notes:[{id:'retained-note',content:'original'}]});
const malformed=[
  ['empty',null],['missing state',{revision:6}],['array state',{revision:6,state:[]}],
  ['missing revision',{state:initial()}],['regressing revision',{revision:4,state:initial()}],
  ['invalid operation revision',{revision:6,operation_revision:7,state:initial()}],
  ['invalid replay flag',{revision:6,operation_replayed:'true',state:initial()}],
];

function fixture(owner,reply){
  const state=initial(),before=structuredClone(state),events=[],messages=[];
  let writes=0,remote={revision:5,state:structuredClone(state)};
  const commit=next=>{writes++;remote={revision:6,state:structuredClone(next)};return typeof reply==='function'?reply(remote):reply};
  const assertCurrent=()=>{},lease={assertCurrent,leaseName:'credit',leaseToken:'fixture',fenceEpoch:1};
  if(owner==='kupa-finance'){
    const transport=createCloudTransport({session:{},supaRest:async(path,options)=>{
      if(path.includes('/rpc/')){const body=JSON.parse(options.body);assert.equal(body.p_expected_revision,5);events.push(body.p_operation_id);return new Response(JSON.stringify(commit(body.p_state)))}
      return new Response(JSON.stringify([{document_name:'main',updated_at:'2026-10-15T00:00:00Z',...remote}]));
    }});
    return {run:()=>transport.saveFinancePatch(base=>({...base,marker:'new'}),lease),recover:()=>transport.readFinanceSyncDocument({assertCurrent}),events,messages,before,state,writes:()=>writes};
  }
  const controller=createDomainsFinanceController({effects:createFinanceBrowserEffects(),
    operationScope:{capture:()=>assertCurrent,captureRead:()=>assertCurrent},tab:{primaryTab:true},checksSession:{kupaCloudReadState:state,checksBankEvents:[]},
    bridge:{getBridgeToken:()=>'',bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,creditAutoMode:()=> 'daily'},loadSession:()=>({}),toast:message=>messages.push(message),
    readKupaReadOnlyCloud:async()=>structuredClone(remote),readFinanceSyncDocument:async()=>structuredClone(remote),
    rpcSaveKupaDocument:async(next,revision,id)=>{assert.equal(revision,5);events.push(id);return {r:{ok:true},row:commit(next)}},
    rpcSaveFinanceSync:async(next,revision,id)=>{assert.equal(revision,5);events.push(id);return {r:{ok:true},row:commit(next)}},
    claimFinanceSyncLease:async(leaseName,leaseToken)=>({acquired:true,...lease,leaseName,leaseToken}),releaseFinanceSyncLease:async()=>true,
    refreshKupaReadout:async options=>{events.push(options);return true},
  });
  return {run:()=>owner==='orders-finance'?controller.saveCreditCardOrder([]):controller.saveCashflowMinimum('business','321'),
    recover:()=>controller.refreshFinanceData(),events,messages,before,state,writes:()=>writes};
}

for(const [name,row] of [
  ['null revision',{revision:null,state:{}}],['boolean revision',{revision:true,state:{}}],
  ['blank revision',{revision:'',state:{}}],['fractional revision',{revision:1.2,state:{}}],
  ['boolean operation revision',{revision:1,operation_revision:true,state:{}}],
  ['multiple results',[{revision:1,state:{}},{revision:2,state:{}}]],
  ['unsafe state',JSON.parse('{"revision":1,"state":{"__proto__":{"polluted":true}}}')],
  ['non-JSON state',{revision:1,state:{value:NaN}}],
])test(`receipt: ${name} cannot prove a first write`,()=>{
  assert.throws(()=>readFinanceWriteReceipt(row,{baseRevision:0,sentState:{}}),{code:'FINANCE_WRITE_RECEIPT_INVALID',kind:'confirmation_unknown',retryable:false});
});

test('receipt preserves legacy no-op equality and numeric revision strings without sharing mutable state',()=>{
  const response={revision:'5',state:{notes:[{id:'same',content:'same'}]}},options={baseRevision:5,sentState:structuredClone(response.state)};
  const receipt=readFinanceWriteReceipt([response],options);assert.equal(receipt.revision,5);
  response.state.notes[0].content='later';assert.equal(receipt.state.notes[0].content,'same');assert.equal(Object.isFrozen(receipt),true);
  assert.throws(()=>readFinanceWriteReceipt({revision:5,state:{}},options),{code:'FINANCE_WRITE_RECEIPT_INVALID'});
});

test('Orders refuses a raw ambiguous envelope even when its first parsed row looks valid',async()=>{
  const controller=createDomainsFinanceController({effects:createFinanceBrowserEffects(),operationScope:{capture:()=>()=>{},captureRead:()=>()=>{}},tab:{primaryTab:true},checksSession:{},
    bridge:{getBridgeToken:()=>'',bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,creditAutoMode:()=> 'daily'},loadSession:()=>({}),toast:()=>{},
    readKupaReadOnlyCloud:async()=>({revision:5,state:initial()}),rpcSaveKupaDocument:async()=>({r:{ok:true},j:[{revision:6,state:initial()},{revision:7,state:initial()}],row:{revision:6,state:initial()}}),
    refreshKupaReadout:async()=>{assert.fail('ambiguous success must not enter publication')},
  });
  assert.equal(await controller.saveCashflowMinimum('business','321'),false);
});

for(const owner of ['kupa-finance','orders-finance','orders-kupa']){
  for(const [name,reply] of malformed)test(`${owner}: HTTP success with ${name} is unknown, not a confirmed write`,async()=>{
    const f=fixture(owner,reply);
    if(owner==='orders-kupa')assert.equal(await f.run(),false);
    else await assert.rejects(f.run(),{code:'FINANCE_WRITE_RECEIPT_INVALID',kind:'confirmation_unknown',retryable:false});
    assert.equal(f.writes(),1,'an unknown commit must not be retried');
    assert.equal(f.events.length,1,'unconfirmed reply must not request success publication');
    assert.deepEqual(f.state,f.before,'unconfirmed reply must not publish the sent candidate');
    await f.recover();assert.equal(f.writes(),1,'authorized read recovery must not repeat the write');
  });
  for(const mode of ['new','no-op','replay'])test(`${owner}: ${mode} confirms the authoritative head`,async()=>{
    const f=fixture(owner,row=>({...row,revision:mode==='no-op'?5:mode==='replay'?9:6,operation_revision:mode==='no-op'?5:6,operation_replayed:mode==='replay',state:{...row.state,serverMarker:'authoritative'}}));
    const result=await f.run();
    if(owner==='kupa-finance'){assert.equal(result.saved,true);assert.equal(result.row.state.serverMarker,'authoritative');assert.equal(result.row.revision,mode==='no-op'?5:mode==='replay'?9:6)}
    else {assert.equal(result,true);assert.equal(f.events[1][owner==='orders-kupa'?'minimumRevision':'minimumFinanceRevision'],mode==='no-op'?5:mode==='replay'?9:6)}
    assert.equal(f.writes(),1);assert.deepEqual(f.state,f.before);
  });
}

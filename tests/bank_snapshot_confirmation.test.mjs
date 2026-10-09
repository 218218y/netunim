import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsBankController} from '../netunim-kupa/site/assets/js/domains/bank/controller.js';
import {createDomainsFinanceController} from '../netunim-orders/site/assets/js/domains/finance/controller.js';
import {createCloudTransport as kupaTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {createCloudTransport as ordersTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createFinanceOperationScope} from '../shared/finance-fence.js';
import {readBankSnapshotReceipt,bankSnapshotReadoutIsCurrent} from '../shared/bank-snapshot-receipt.js';

const stamp='2026-10-09T10:00:00.000Z';
const receipt={finance_revision:9,kupa_revision:4,updated_at:stamp};
test('Bank receipt preserves optional server metadata, accepts either published row form and is immutable',()=>{
  const input={...receipt,future_field:{retained:true}},decoded=readBankSnapshotReceipt([input]);
  assert.deepEqual(decoded,input);assert.notEqual(decoded,input);assert.equal(Object.isFrozen(decoded),true);
  assert.throws(()=>{decoded.kupa_revision=0},TypeError);
  assert.equal(bankSnapshotReadoutIsCurrent(decoded,{verified:true,revision:5,financeRevision:10}),true);
  assert.equal(bankSnapshotReadoutIsCurrent(decoded,{verified:true,revision:4,financeRevision:9}),true);
  for(const head of [null,{}, {verified:false,revision:4,financeRevision:9},{verified:true,revision:'4',financeRevision:9},{verified:true,revision:4,financeRevision:NaN}])assert.equal(bankSnapshotReadoutIsCurrent(decoded,head),false);
});
test('unknown Bank confirmation is classified without asserting that the server failed or enabling retry',()=>{
  for(const input of [null,[],[receipt,receipt],{...receipt,kupa_revision:Number.MAX_SAFE_INTEGER+1},{...receipt,finance_revision:Infinity},{...receipt,finance_revision:0}, {revision:9}]){
    assert.throws(()=>readBankSnapshotReceipt(input),error=>error.code==='BANK_SNAPSHOT_RECEIPT_INVALID'&&error.kind==='confirmation_unknown'&&error.retryable===false&&error.message.includes('ייתכן שהשרת שמר'));
  }
});
function fixture(t,site,body,{heads={revision:4,financeRevision:9}}={}){
  t.mock.method(globalThis,'setTimeout',()=>1);t.mock.method(globalThis,'clearTimeout',()=>{});
  const prior=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  t.after(()=>{if(prior)Object.defineProperty(globalThis,'navigator',prior);else delete globalThis.navigator});
  const state={bank:{source:'hapoalim',currentBalance:100,archiveInitialized:true,archiveVersion:2,bankSyncAt:'2020-01-01T00:00:00Z',feed:{accountNumber:'account',balance:100,syncedAt:'2020-01-01T00:00:00Z',transactions:[]}},creditSync:{profiles:[]},notes:[{id:'retained',content:'retained'}],checks:[]};
  const model={state:structuredClone(state)},checksSession={kupaCloudReadState:structuredClone(state),checksBankEvents:[]},messages=[];
  let calls=0,reads=0,scrapes=0,serverBank=null;
  const request=async(path,options)=>{assert.match(path,/save_bank_sync_snapshot_v6$/);options.assertRequestScope?.();calls++;serverBank=JSON.parse(options.body).p_bank_state;return new Response(body)};
  const transport=(site==='kupa'?kupaTransport:ordersTransport)({session:{cloudDocumentName:'main'},supaRest:request,supaFetch:request});
  const operationScope=createFinanceOperationScope({readAccess:()=>({account:{owner:'fixture',epoch:1},storageOwner:'fixture',connectionMode:'supabase',writable:true,readable:true})});
  const bridge={getBridgeToken:()=> 'paired',autoEnabled:()=>false,bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,creditAutoMode:()=> 'smart',autoAttemptDelayMs:()=>0,markAutoAttempt(){},bankAttemptReady:()=>true,creditAttemptReady:()=>true,
    status:async()=>({bridgeVersion:73,configured:true}),fetchBalance:async()=>{scrapes++;return {fetchedAt:stamp,accounts:{business:{balance:500,accountId:'account',transactions:[]}}}}};
  const ports={model,session:{connectionMode:'supabase',backendReady:true},checksSession,operationScope,autoScope:()=>null,tab:{primaryTab:true},loadSession:()=>({user:{id:'fixture'}}),toast:message=>messages.push(message),render(){},readRevision:()=>0,
    sharedChecksHaveLocalWork:()=>false,checksHaveLocalWork:()=>false,getSharedChecks:()=>[],saveSharedChecksToCloud:async()=>true,syncSharedChecksFromCloud:async()=>true,sharedChecksObservedSequence:()=>0,bridge,
    refreshFinanceCloudSnapshot:async()=>{reads++;return {verified:true,state:model.state,...heads}},
    refreshKupaReadout:async()=>{reads++;if(serverBank)checksSession.kupaCloudReadState={...structuredClone(state),bank:structuredClone(serverBank)};return true},
    claimFinanceSyncLease:async()=>({acquired:true,leaseName:'bank',leaseToken:'L',fenceEpoch:1}),releaseFinanceSyncLease:async()=>true,
    saveBankSyncSnapshot:(...args)=>transport.saveBankSyncSnapshot(...args),syncBankTransactionsSnapshot:async()=>({sourcePayload:[],result:{total_count:0}}),
    readBankTransactions:async()=>[{id:'candidate-archive',date:stamp,amount:12}],readBankTransactionSnapshot:async()=>null,syncBankChequeImages:async()=>({warnings:[]}),
  };
  const api=(site==='kupa'?createDomainsBankController:createDomainsFinanceController)(ports);t.after(()=>api.stopAutoSync?.());
  return {api,model,checksSession,state,messages,run:()=>site==='kupa'?api.refreshBankBalance():api.refreshBank(),counts:()=>({calls,reads,scrapes})};
}
const invalid=['','not JSON','null','[]','{}','[{},{}]',JSON.stringify({...receipt,finance_revision:0}),JSON.stringify({...receipt,kupa_revision:-1}),JSON.stringify({...receipt,finance_revision:'9'}),JSON.stringify({...receipt,kupa_revision:4.5})];
for(const site of ['kupa','orders'])for(const body of invalid)test(`${site}: HTTP 200 with invalid Bank confirmation ${body||'(empty)'} cannot publish or claim success`,async t=>{
  const f=fixture(t,site,body);assert.equal(await f.run(),false,'HTTP success is not proof of an atomic Bank commit');
  assert.deepEqual(site==='kupa'?f.model.state:f.checksSession.kupaCloudReadState,f.state);
  assert.deepEqual(f.counts(),{calls:1,reads:1,scrapes:1},'no post-commit read or automatic provider retry follows an unconfirmed result');
  assert.ok(f.messages.some(message=>message.includes('אישור')),'operator receives an explicit unknown-confirmation diagnostic');
});
for(const site of ['kupa','orders'])for(const body of [JSON.stringify(receipt),JSON.stringify([receipt])])test(`${site}: actual scalar/single-row SQL receipt confirms the separate Finance/Main heads`,async t=>{
  const f=fixture(t,site,body);assert.equal(await f.run(),true);assert.equal((site==='kupa'?f.model.state:f.checksSession.kupaCloudReadState).bank.currentBalance,500);assert.deepEqual(f.counts(),{calls:1,reads:2,scrapes:1});
});
for(const heads of [{revision:3,financeRevision:9},{revision:4,financeRevision:8}])test(`Kupa: confirmed Bank commit with an older readout ${JSON.stringify(heads)} retains its independent refresh warning`,async t=>{
  const f=fixture(t,'kupa',JSON.stringify(receipt),{heads});assert.equal(await f.run(),true,'the valid remote commit remains committed');
  assert.equal(f.model.state.bank.currentBalance,500);assert.match(f.api.bankBridgeUiState().lastWarning,/לא אומת/);assert.equal(f.counts().calls,1);
});

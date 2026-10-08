import test from 'node:test';
import assert from 'node:assert/strict';
import {createDomainsFinanceController} from '../netunim-orders/site/assets/js/domains/finance/controller.js';
import {createDomainsBankCache} from '../netunim-orders/site/assets/js/domains/bank/cache.js';
import {createFinanceOperationScope} from '../shared/finance-fence.js';
import {createCloudTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createUiCloud} from '../netunim-orders/site/assets/js/ui/cloud.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
const stamp='2026-10-08T10:00:00.000Z';
const transaction=id=>({id,date:stamp,processedDate:stamp,amount:12,currency:'ILS',status:'completed',description:id});
function fixture(t,{hold=null}={}){
  const jobs=new Map();let timer=0,owner='A',epoch=1,primary=true,refreshes=0,checks=0;
  t.mock.method(globalThis,'setTimeout',fn=>{jobs.set(++timer,fn);return timer});t.mock.method(globalThis,'clearTimeout',id=>jobs.delete(id));t.mock.method(console,'error',()=>{});
  const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});t.after(()=>{if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator});
  const counts={},entered=deferred(),release=deferred(),operationScope=createFinanceOperationScope({readAccess:()=>({account:{owner,epoch},storageOwner:owner||'A',connectionMode:'supabase',writable:primary,readable:true})});
  const state={bank:{currentBalance:100,source:'hapoalim',bankSyncAt:'2020-01-01T00:00:00Z',archiveInitialized:true,archiveVersion:2,feed:{accountNumber:'same-account',balance:100,syncedAt:'2020-01-01T00:00:00Z',transactions:[]}},creditSync:{version:3,syncedAt:'2020-01-01T00:00:00Z',profiles:[],errors:[]},notes:[{id:'retained',content:'retained'}]},checksSession={kupaCloudReadState:structuredClone(state),checksBankEvents:[]},before=structuredClone(checksSession);
  let remote=structuredClone(state);
  const phase=async(name,value)=>{counts[name]=(counts[name]||0)+1;if(name===hold){entered.resolve();await release.promise}return value};
  const ports={operationScope,tab:{get primaryTab(){return primary}},checksSession,loadSession:()=>owner?{user:{id:owner}}:null,toast:()=>{},
    refreshKupaReadout:async(options={})=>{options.assertCurrent?.();await phase('refresh-'+(++refreshes),true);options.assertCurrent?.();checksSession.kupaCloudReadState=structuredClone(remote);return true},
    readKupaReadOnlyCloud:options=>{options?.assertCurrent?.();return phase('kupa-read',{revision:1,state:remote})},rpcSaveKupaDocument:()=>phase('kupa-save',{r:{ok:true},row:{revision:2,state:remote}}),acceptKupaCloudRow:()=>{},
    syncSharedChecksFromCloud:()=>phase('checks-'+(++checks),true),saveSharedChecksToCloud:async()=>true,checksHaveLocalWork:()=>false,
    readFinanceSyncDocument:options=>{options?.assertCurrent?.();return phase('finance-read',{revision:1,state:remote})},
    rpcSaveFinanceSync:async(candidate)=>{await phase('finance-save',null);remote=structuredClone(candidate);return {r:{ok:true},row:{revision:2,state:remote}}},
    claimFinanceSyncLease:()=>phase('claim',{acquired:true,leaseName:'bank',leaseToken:'L',fenceEpoch:1}),releaseFinanceSyncLease:(_kind,_token,options)=>{options?.assertCurrent?.();return phase('release',true)},
    saveBankSyncSnapshot:async bank=>{await phase('atomic',null);remote={...remote,bank};return {revision:2}},
    syncBankTransactionsSnapshot:()=>phase('archive',{sourcePayload:[],result:{total_count:0}}),readBankTransactions:()=>phase('archive-read',[]),readBankTransactionSnapshot:async()=>null,syncBankChequeImages:()=>phase('images',{warnings:[]}),
    setBankTransactionHandled:()=>phase('handled',{handled_at:stamp}),acknowledgeBankTransactionMissing:()=>phase('missing',{acknowledged_at:stamp}),acknowledgeBankTransactionAlert:()=>phase('alert',{acknowledged_at:stamp}),
    bridge:{getBridgeToken:()=> 'fixture',bankAutoEnabled:()=>true,creditAutoEnabled:()=>true,creditAutoMode:()=> 'smart',markBankAttempt:()=>{},markCreditAttempt:()=>{},bankAttemptReady:()=>true,creditAttemptReady:()=>true,
      status:()=>phase('bank-status',{bridgeVersion:73,configured:true}),creditStatus:()=>phase('credit-status',{bridgeVersion:73,contractVersion:2,profiles:[{profileId:'P'}]}),
      fetchBalance:()=>phase('bank-provider',{fetchedAt:stamp,accounts:{business:{balance:500,accountId:'same-account',transactions:[]}}}),
      syncCreditCards:()=>phase('credit-provider',{syncedAt:stamp,attemptedCount:1,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'card',txns:[{id:'issuer-tx',date:stamp,chargedAmount:-12}]}]}],errors:[]}),resetCreditProfiles:()=>phase('reset',true)},
  };
  return {ports,before,counts,jobs,entered,release,checksSession,operationScope,create:()=>createDomainsFinanceController(ports),handoff:()=>{owner='B';epoch++},logout:()=>{owner=null;epoch++},relogin:()=>epoch++,secondary:()=>{primary=false},remote:()=>remote};
}

for(const kind of ['Bank','Credit'])for(const auto of [false,true])for(const [name,change] of [['logout',f=>f.logout()],['account change',f=>f.handoff()],['same-user relogin',f=>f.relogin()],['leadership loss',f=>f.secondary()]])test(`Orders ${kind} ${auto?'automatic':'manual'} ${name} after provider entry prevents further publication`,async t=>{
  const f=fixture(t,{hold:kind.toLowerCase()+'-provider'}),api=f.create(),pending=api['refresh'+kind]({auto});await f.entered.promise;change(f);f.release.resolve();
  assert.equal(await pending,false);assert.deepEqual(f.checksSession,f.before);assert.equal(f.counts.atomic||0,0);assert.equal(f.counts['finance-save']||0,0);assert.equal(f.counts.archive||0,0);assert.equal(f.counts.release||0,0);api.stopAutoSync?.();
});

for(const [kind,phase] of [['Bank','archive'],['Bank','images'],['Bank','archive-read'],['Bank','checks-2'],['Bank','atomic'],['Credit','finance-read'],['Credit','finance-save']])test(`Orders ${kind} scope closes during ${phase}`,async t=>{
  const f=fixture(t,{hold:phase}),api=f.create(),pending=api['refresh'+kind]();await f.entered.promise;f.handoff();f.checksSession.kupaCloudReadState={bank:{currentBalance:999}};const next=structuredClone(f.checksSession);f.release.resolve();
  assert.equal(await pending,false);assert.deepEqual(f.checksSession,next);assert.equal(f.counts.release||0,0);api.stopAutoSync?.();
});

test('Orders failed Bank snapshot cannot replace the displayed archive',async t=>{
  const f=fixture(t);f.ports.readBankTransactions=async()=>[transaction('uncommitted')];f.ports.saveBankSyncSnapshot=async()=>{throw Error('atomic failure')};const api=f.create();
  assert.equal(await api.refreshBank(),false);assert.deepEqual(api.snapshot().bank.feed.transactions,[]);assert.deepEqual(f.checksSession,f.before);api.stopAutoSync?.();
});

test('Orders archive reads and memoized projection do not reuse another login cache',async t=>{
  const f=fixture(t);let reads=0;f.ports.readRevision=()=>1;f.ports.readBankTransactions=async()=>[transaction(++reads===1?'private-A':'private-B')];const api=f.create();
  await api.ensureBankDisplayArchive();assert.equal(api.readSnapshot().bank.feed.transactions[0].id,'private-A');f.handoff();
  assert.deepEqual(api.readSnapshot().bank.feed.transactions,[]);await api.ensureBankDisplayArchive();assert.equal(reads,2);assert.equal(api.readSnapshot().bank.feed.transactions[0].id,'private-B');api.stopAutoSync?.();
});

for(const method of ['saveCreditCardOrder','setCreditCardMapping','acknowledgeCreditSettlementWarning','saveCashflowMinimum','resetCreditSync','toggleBankTransactionHandled','acknowledgeMissingBankTransaction','acknowledgePersistentBankAlert'])test(`Orders ${method} cannot publish after login changes while awaiting its port`,async t=>{
  const phase={saveCreditCardOrder:'finance-read',setCreditCardMapping:'finance-read',acknowledgeCreditSettlementWarning:'finance-read',saveCashflowMinimum:'kupa-read',resetCreditSync:'reset',toggleBankTransactionHandled:'handled',acknowledgeMissingBankTransaction:'missing',acknowledgePersistentBankAlert:'alert'}[method];
  const args={saveCreditCardOrder:[[]],setCreditCardMapping:['P','card','included',true],acknowledgeCreditSettlementWarning:['credit_settlement_unmatched:1'],saveCashflowMinimum:['business',500],resetCreditSync:[],toggleBankTransactionHandled:[1,true],acknowledgeMissingBankTransaction:[1],acknowledgePersistentBankAlert:[1,'returned_cheque']}[method];
  const f=fixture(t,{hold:phase}),api=f.create(),pending=api[method](...args).catch(error=>{assert.equal(error.code,'FINANCE_OPERATION_SCOPE_CHANGED');return false});await f.entered.promise;f.relogin();f.release.resolve();
  assert.equal(await pending,false);assert.deepEqual(f.checksSession,f.before);assert.equal(f.counts['finance-save']||0,0);assert.equal(f.counts['kupa-save']||0,0);api.stopAutoSync?.();
});

for(const force of [false,true])test(`Orders readout ${force?'GET':'meta fast path'} cannot publish after logout`,async t=>{
  const f=fixture(t),gate=deferred(),entered=deferred(),before=structuredClone(f.checksSession);f.checksSession.kupaReadRevision=7;f.checksSession.financeReadRevision=7;
  const api=createDomainsBankCache({operationScope:f.operationScope,checksSession:f.checksSession,ui:{currentView:'kupa'},loadSession:f.ports.loadSession,computeKupaNetReadout:()=>0,renderChecks:()=>{},renderSummary:()=>{},
    readKupaReadOnlyCloud:async()=>{entered.resolve();await gate.promise;return {revision:8,financeRevision:8,state:{bank:{currentBalance:888}}}},readKupaReadOnlyMeta:async()=>{entered.resolve();await gate.promise;return {revision:7,financeRevision:7}}});
  const pending=api.refreshKupaReadout({force});await entered.promise;f.logout();gate.resolve();assert.equal(await pending,false);assert.deepEqual(f.checksSession.kupaCloudReadState,before.kupaCloudReadState);
});

test('Orders Finance RPC carries scope into the authenticated transport and rejects a late body',async()=>{
  let valid=true,requests=0;const assertCurrent=()=>{if(!valid)throw Object.assign(Error('scope changed'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})};
  const api=createCloudTransport({supaFetch:async(_path,options)=>{assert.equal(options.assertRequestScope,assertCurrent);requests++;return {ok:true,text:async()=>{valid=false;return '[{"revision":2}]'}}}});
  await assert.rejects(api.rpcSaveFinanceSync({},1,'operation',{}, {assertCurrent}),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.equal(requests,1);
});

test('Orders older parallel readout cannot replace a newer published Main/Finance head',async t=>{
  const f=fixture(t),gate=deferred(),entered=deferred();let reads=0;
  const api=createDomainsBankCache({operationScope:f.operationScope,checksSession:f.checksSession,ui:{currentView:'kupa'},loadSession:f.ports.loadSession,computeKupaNetReadout:()=>0,renderChecks:()=>{},renderSummary:()=>{},
    readKupaReadOnlyCloud:async()=>{if(++reads===1){entered.resolve();return gate.promise}return {revision:2,financeRevision:2,state:{bank:{currentBalance:222}}}}});
  const old=api.refreshKupaReadout({force:true});await entered.promise;assert.equal(await api.refreshKupaReadout({force:true}),true);gate.resolve({revision:1,financeRevision:1,state:{bank:{currentBalance:111}}});await old;
  assert.equal(f.checksSession.kupaCloudReadState.bank.currentBalance,222);assert.equal(f.checksSession.kupaReadRevision,2);assert.equal(f.checksSession.financeReadRevision,2);
});

test('Orders display read started before Bank refresh cannot publish uncommitted archive rows',async t=>{
  const f=fixture(t,{hold:'bank-provider'}),gate=deferred();let reads=0;
  f.ports.readBankTransactions=async()=>++reads===1?gate.promise:[];
  f.ports.saveBankSyncSnapshot=async()=>{throw Error('snapshot response lost')};
  const api=f.create(),old=api.ensureBankDisplayArchive(),refresh=api.refreshBank();await f.entered.promise;
  gate.resolve([transaction('uncommitted')]);await old;f.release.resolve();assert.equal(await refresh,false);
  assert.deepEqual(api.snapshot().bank.feed.transactions,[]);api.stopAutoSync();
});

test('Orders preflight readout cannot start an archive publication while Bank owns the refresh',async t=>{
  const f=fixture(t);let api;
  f.ports.refreshKupaReadout=async()=>{await api.ensureBankDisplayArchive();return true};
  f.ports.readBankTransactions=async()=>[transaction('uncommitted')];
  f.ports.saveBankSyncSnapshot=async()=>{throw Error('snapshot failed')};api=f.create();
  assert.equal(await api.refreshBank(),false);assert.deepEqual(api.snapshot().bank.feed.transactions,[]);api.stopAutoSync();
});

for(const kind of ['Bank','Credit'])test(`Orders automatic ${kind} stop during preflight prevents lease/provider entry`,async t=>{
  const f=fixture(t,{hold:'refresh-1'}),api=f.create(),pending=api['maybeAutoRefresh'+kind]();await f.entered.promise;api.stopAutoSync();f.release.resolve();
  assert.equal(await pending,false);assert.equal(f.counts.claim||0,0);assert.equal(f.counts[kind.toLowerCase()+'-provider']||0,0);assert.equal(f.jobs.size,0);
});

for(const kind of ['Bank','Credit'])test(`Orders ${kind} already-started provider drains after stop, without resurrecting timers`,async t=>{
  const f=fixture(t,{hold:kind.toLowerCase()+'-provider'}),api=f.create(),pending=api['maybeAutoRefresh'+kind]();await f.entered.promise;api.stopAutoSync();f.release.resolve();
  assert.equal(await pending,true);assert.equal(f.counts[kind==='Bank'?'atomic':'finance-save'],1);assert.equal(f.jobs.size,0);
});

test('Orders stopped and restarted automatic owner ignores a cancelled timer callback',async t=>{
  const f=fixture(t),api=f.create();api.startAutoSync();const old=[...f.jobs.values()];assert.equal(old.length,2);
  api.stopAutoSync();api.startAutoSync();for(const run of old)run();await Promise.resolve();
  assert.equal(f.counts['refresh-1']||0,0);assert.equal(f.jobs.size,2);api.stopAutoSync();assert.equal(f.jobs.size,0);
});

test('Orders former provider completion cannot stop an explicitly restarted new-login scheduler',async t=>{
  const f=fixture(t,{hold:'bank-provider'}),api=f.create();api.startAutoSync();const pending=api.maybeAutoRefreshBank();await f.entered.promise;
  f.relogin();api.startAutoSync();assert.equal(f.jobs.size,3);f.release.resolve();assert.equal(await pending,false);
  assert.equal(f.jobs.size,2);api.stopAutoSync();
});

test('Orders logout explicitly stops the Finance scheduler before clearing authorization',t=>{
  const calls=[],original=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{removeItem:()=>{}}});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'localStorage',original);else delete globalThis.localStorage});
  const api=createUiCloud({session:{},checksSession:{},stopPolling:()=>{},stopFinanceAutoSync:()=>calls.push('stop'),saveSession:()=>calls.push('logout'),setCloud:()=>{},renderSettings:()=>{},toast:()=>{}});
  assert.equal(api.logoutCloud(),true);assert.deepEqual(calls,['stop','logout']);
});

test('Orders readable secondary tab may retrieve its own Bank archive',async t=>{
  const f=fixture(t);f.secondary();f.ports.readBankTransactions=async()=>[transaction('secondary')];const api=f.create();
  assert.equal(await api.ensureBankDisplayArchive(),true);assert.equal(api.snapshot().bank.feed.transactions[0].id,'secondary');assert.equal(await api.refreshBank(),false);api.stopAutoSync();
});

for(const kind of ['Bank','Credit'])test(`Orders committed ${kind} with unavailable readout reports a visible publication warning`,async t=>{
  const f=fixture(t);let reads=0;f.ports.refreshKupaReadout=async()=>++reads===1;const api=f.create();
  assert.equal(await api['refresh'+kind](),true);assert.deepEqual(f.checksSession,f.before);
  assert.match(kind==='Bank'?api.snapshot().bankStatus.lastWarning:api.snapshot().creditError,/רענון התצוגה.*לא אומת/);api.stopAutoSync();
});

test('Orders rejected deferred diagnostics save cannot report successful Credit refresh',async t=>{
  const f=fixture(t);f.ports.bridge.syncCreditCards=async()=>{throw Object.assign(Error('provider cooldown'),{creditErrors:[{profileId:'P',severity:'deferred',deferred:true,message:'cooldown'}]})};
  f.ports.rpcSaveFinanceSync=async()=>{throw Error('diagnostics response lost')};const api=f.create();
  assert.equal(await api.refreshCredit(),false);assert.match(api.snapshot().creditError,/diagnostics response lost/);assert.deepEqual(f.checksSession,f.before);api.stopAutoSync();
});

test('Orders Credit reset preserves the warning when committed reset cannot refresh its readout',async t=>{
  const f=fixture(t);f.ports.bridge.setCreditAutoEnabled=()=>{};f.ports.bridge.setCreditAutoMode=()=>{};f.ports.refreshKupaReadout=async()=>false;const api=f.create();
  assert.equal(await api.resetCreditSync(),true);assert.match(api.snapshot().creditError,/רענון התצוגה.*לא אומת/);api.stopAutoSync();
});

test('Orders deferred diagnostics commit retains its publication warning',async t=>{
  const f=fixture(t);let reads=0;f.ports.refreshKupaReadout=async()=>++reads===1;f.ports.bridge.syncCreditCards=async()=>{throw Object.assign(Error('provider cooldown'),{creditErrors:[{profileId:'P',severity:'deferred',deferred:true,message:'cooldown'}]})};const api=f.create();
  assert.equal(await api.refreshCredit(),true);assert.match(api.snapshot().creditError,/רענון התצוגה.*לא אומת/);api.stopAutoSync();
});

for(const [method,args,field] of [['acknowledgeMissingBankTransaction',[1],'missingAcknowledgedAt'],['acknowledgePersistentBankAlert',[1,'returned_cheque'],'alertAcknowledgements']])test(`Orders ${method} invalidates its memoized read model after confirmation`,async t=>{
  const f=fixture(t);f.ports.readRevision=()=>1;f.checksSession.kupaCloudReadState.bank.feed.transactions=[{...transaction('T'),archiveId:1}];const api=f.create();
  assert.equal(api.readSnapshot().bank.feed.transactions[0][field]===null||Object.keys(api.readSnapshot().bank.feed.transactions[0][field]).length===0,true);
  assert.equal(await api[method](...args),true);assert.deepEqual(api.readSnapshot().bank.feed.transactions[0][field],field==='alertAcknowledgements'?{returned_cheque:stamp}:stamp);api.stopAutoSync();
});

test('Orders commit readout refuses a Main or Finance response behind the acknowledged head',async t=>{
  const f=fixture(t),api=createDomainsBankCache({operationScope:f.operationScope,checksSession:f.checksSession,ui:{currentView:'kupa'},loadSession:f.ports.loadSession,computeKupaNetReadout:()=>0,renderChecks:()=>{},renderSummary:()=>{},readKupaReadOnlyCloud:async()=>({revision:1,financeRevision:1,state:{bank:{currentBalance:111}}})});
  for(const minimum of [{minimumRevision:2},{minimumFinanceRevision:2}])assert.equal(await api.refreshKupaReadout({force:true,...minimum}),false);
  assert.deepEqual(f.checksSession.kupaCloudReadState,f.before.kupaCloudReadState);
});

for(const kind of ['Bank','Credit'])test(`Orders lost ${kind} commit response retains Last Known Good and explicit read recovers record identity`,async t=>{
  const f=fixture(t),key=kind==='Bank'?'saveBankSyncSnapshot':'rpcSaveFinanceSync',save=f.ports[key];
  f.ports[key]=async(...args)=>{await save(...args);throw Error('commit response lost')};const api=f.create();assert.equal(await api['refresh'+kind](),false);assert.deepEqual(f.checksSession,f.before);
  await api.refreshFinanceData();assert.deepEqual(f.checksSession.kupaCloudReadState.notes,f.before.kupaCloudReadState.notes);
  if(kind==='Bank')assert.equal(api.snapshot().bank.currentBalance,500);
  else assert.deepEqual(api.snapshot().creditSync.profiles[0].accounts[0].txns.map(row=>row.id),['issuer-tx']);api.stopAutoSync();
});

const transportCalls=[
  ['readFinanceSyncDocument',guard=>[{assertCurrent:guard}]],
  ['readKupaReadOnlyCloud',guard=>[{assertCurrent:guard}]],
  ['readKupaReadOnlyMeta',guard=>[{assertCurrent:guard}]],
  ['claimFinanceSyncLease',guard=>['bank','L',{assertCurrent:guard}]],
  ['releaseFinanceSyncLease',guard=>['bank','L',{assertCurrent:guard}]],
  ['saveBankSyncSnapshot',guard=>[{},'snapshot',0,{assertCurrent:guard}]],
  ['mergeBankTransactions',guard=>['account','business',[],{assertCurrent:guard}]],
  ['syncBankTransactionsSnapshot',guard=>['account','business',[],{snapshotAt:stamp,lease:{assertCurrent:guard}}]],
  ['readBankTransactionSnapshot',guard=>['account','business',{assertCurrent:guard}]],
  ['setBankTransactionHandled',guard=>[1,true,{assertCurrent:guard}]],
  ['acknowledgeBankTransactionMissing',guard=>[1,{assertCurrent:guard}]],
  ['acknowledgeBankTransactionAlert',guard=>[1,'returned_cheque',{assertCurrent:guard}]],
  ['rpcSaveKupaDocument',guard=>[{credits:[],cash:[],rights:[],notes:[],expenses:[],cards:[]},1,'operation',{}, {assertCurrent:guard}]],
];
for(const [method,args] of transportCalls)test(`Orders ${method} fences request entry and late body consumption`,async()=>{
  let valid=false,requests=0;const assertCurrent=()=>{if(!valid)throw Object.assign(Error('scope changed'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})};
  const api=createCloudTransport({supaFetch:async(_url,options)=>{assert.equal(options.assertRequestScope,assertCurrent);requests++;return {ok:true,json:async()=>{valid=false;return []},text:async()=>{valid=false;return '[]'}}}});
  await assert.rejects(api[method](...args(assertCurrent)),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.equal(requests,0);
  valid=true;await assert.rejects(api[method](...args(assertCurrent)),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.ok(requests>0);
});

test('Orders Bank pagination stops before the next page after owner changes during a body read',async()=>{
  let valid=true,requests=0;const assertCurrent=()=>{if(!valid)throw Object.assign(Error('scope changed'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})};
  const api=createCloudTransport({supaFetch:async(_url,options)=>{assert.equal(options.assertRequestScope,assertCurrent);requests++;return {ok:true,json:async()=>{valid=false;return Array.from({length:1000},()=>({id:1}))}}}});
  await assert.rejects(api.readBankTransactions('account','business',{assertCurrent}),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});assert.equal(requests,1);
});

test('Orders Bank Morning links GET/RPC share the same read scope through response parsing',async()=>{
  let requests=0;const assertCurrent=()=>{};
  const api=createCloudTransport({supaFetch:async(_url,options)=>{assert.equal(options.assertRequestScope,assertCurrent);requests++;return {ok:true,json:async()=>[],text:async()=> '[]'}}});
  assert.deepEqual(await api.readBankTransactions('account','business',{assertCurrent}),[]);assert.equal(requests,2);
});

for(const kind of ['Bank','Credit'])test(`Orders rejected ${kind} provider response cannot publish former-account diagnostics`,async t=>{
  const f=fixture(t,{hold:kind.toLowerCase()+'-provider'}),method=kind==='Bank'?'fetchBalance':'syncCreditCards',request=f.ports.bridge[method];
  f.ports.bridge[method]=async()=>{await request();throw Object.assign(Error('private former-account response'),{availableAccounts:[{accountNumber:'private'}],accountRole:'home'})};const api=f.create(),pending=api['refresh'+kind]();
  await f.entered.promise;f.handoff();f.release.resolve();assert.equal(await pending,false);assert.equal(api.snapshot()[kind.toLowerCase()+'Error'].includes('private'),false);
  assert.equal(api.snapshot().bankStatus?.availableAccounts,undefined);assert.equal(f.counts['finance-save']||0,0);api.stopAutoSync();
});

test('Orders projection invalidates once per authorization transition and stays warm while unauthenticated',t=>{
  const f=fixture(t);f.ports.readRevision=()=>1;const api=f.create(),authorized=api.readSnapshot();assert.equal(api.readSnapshot().kupa,authorized.kupa);
  f.logout();const loggedOut=api.readSnapshot();assert.notEqual(loggedOut.kupa,authorized.kupa);assert.equal(api.readSnapshot().kupa,loggedOut.kupa);
  f.handoff();const replacement=api.readSnapshot();assert.notEqual(replacement.kupa,loggedOut.kupa);assert.equal(api.readSnapshot().kupa,replacement.kupa);api.stopAutoSync();
});

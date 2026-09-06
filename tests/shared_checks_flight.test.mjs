import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedChecksFlight} from '../shared/shared-checks-flight.js';
import {createSyncChecks as ordersChecks} from '../netunim-orders/site/assets/js/sync/checks.js';
import {createSyncChecks as kupaChecks} from '../netunim-kupa/site/assets/js/sync/checks.js';
import {createDomainsBankController} from '../netunim-kupa/site/assets/js/domains/bank/controller.js';
import {createDomainsFinanceController} from '../netunim-orders/site/assets/js/domains/finance/controller.js';

const noop=()=>{},clone=structuredClone;
function gate(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});

function fixture(app,t){
  // Timers are existing UI debounce/retry scheduling, never the ordering oracle.
  // Tests release explicit read/ACK/mirror gates; no timer is advanced.
  t.mock.method(globalThis,'setTimeout',()=>0);
  const prefix=app==='orders'?'checks':'sharedChecks',baseKey=app==='orders'?'checksCloudBase':'sharedChecksBase';
  const cs={[baseKey]:[],[prefix+'Generation']:0,[prefix+'BankEvents']:[],[prefix+'OutboxCommitPromise']:Promise.resolve()};
  const session={backendReady:true,connectionMode:'supabase',dbRevision:1};
  const model={state:{checks:[],bank:{adjustments:[]}}};
  let pending=null,head={revision:7,state:{checks:[],bankEvents:[]}},readGate=null,ackGate=null,mirrorGate=null,bankWrites=0;
  const readStarted=gate(),saveStarted=gate(),mirrorStarted=gate(),calls=[];
  const get=async()=>clone(pending);
  function mark(snapshot,_message,conflict,options={}){
    pending={generation:cs[prefix+'Generation'],operationId:'op-'+cs[prefix+'Generation'],snapshot:clone(snapshot),baseState:clone(cs[baseKey]),baseRevision:head.revision,...options,conflict};
    cs[prefix+'OutboxCached']=pending;
  }
  function stage(amount,options={}){model.state.checks=[{id:'C',amount}];cs[prefix+'Generation']++;mark(model.state.checks,'',undefined,options)}
  const read=async()=>{calls.push(['read',head.revision]);readStarted.resolve();const observed=clone(head);if(readGate)await readGate.promise;return observed};
  const clear=async generation=>{if(pending?.generation!==generation)return false;pending=null;cs[prefix+'OutboxCached']=null;return true};
  const mirror=async()=>{mirrorStarted.resolve();if(mirrorGate)await mirrorGate.promise};
  const rpc=async(snapshot,expected,operation,deleted)=>{
    calls.push(['save',clone(snapshot),expected,operation,deleted]);saveStarted.resolve();
    if(ackGate)await ackGate.promise;
    assert.equal(expected,head.revision);head={revision:head.revision+1,state:{checks:clone(snapshot),bankEvents:[{seq:42,checkId:'C',delta:100}]}};
    return {r:{ok:true},row:clone(head)};
  };
  const deps={model,session,checksSession:cs,tab:{primaryTab:true},files:{dirHandle:true,backupsDirHandle:true},loadSession:()=>session.backendReady,
    localSnapshot:noop,persistChecksBase:noop,persistSharedChecksBase:noop,persistImmediateBrowserSnapshot:noop,
    markChecksPending:mark,markSharedChecksPending:mark,getChecksPending:get,getSharedChecksPending:get,
    clearChecksPending:clear,clearSharedChecksPending:clear,checksPendingExists:()=>!!pending,sharedChecksPendingExists:()=>!!pending,
    checksHaveLocalWork:()=>!!pending,sharedChecksHaveLocalWork:()=>!!pending,readSharedChecksCloud:read,readSharedChecksDocument:read,
    readSharedChecksCloudMeta:async()=>({revision:head.revision}),readSharedChecksMeta:async()=>({revision:head.revision}),rpcSaveSharedChecks:rpc,
    writeStateToFolder:mirror,backupSnapshotToComputer:mirror,queueSharedChecksSave:noop,toast:noop,render:noop,renderKupaDependentView:noop,
    recomputeKupaNetFromCache:noop,refreshCloudTimestamp:noop,refreshCloudHeaderTimestamp:noop,setSaveStatus:noop,setCloudHeaderStatus:noop};
  const api=(app==='orders'?ordersChecks:kupaChecks)(deps);
  // Real bank commit contract, driven by each app's real sync implementation.
  const bank=createDomainsBankController({model,session,checksSession:cs,sharedChecksHaveLocalWork:()=>!!pending,
    saveSharedChecksToCloud:api.saveSharedChecksToCloud,syncSharedChecksFromCloud:api.syncSharedChecksFromCloud,
    sharedChecksObservedSequence:()=>Math.max(0,...cs[prefix+'BankEvents'].map(e=>e.seq)),
    saveState:async()=>{bankWrites++;return true},toast:noop,render:noop,bridge:{}});
  return {api,bank,cs,session,model,calls,readStarted,saveStarted,mirrorStarted,stage,get,
    holdRead:()=>readGate=gate(),holdAck:()=>ackGate=gate(),holdMirror:()=>mirrorGate=gate(),
    writes:()=>bankWrites,pending:()=>pending,head:()=>head};
}

test('coordinator reserves and shares exact promises, serializes opposite operations, and derives status',async()=>{
  const state={},f=createSharedChecksFlight({state,pullKey:'pull',saveKey:'save',busyKey:'busy'}),g=gate(),started=gate(),order=[];
  const pull=f.pull(async()=>{order.push('pull');started.resolve();await g.promise;return true});
  assert.equal(f.pull(()=>assert.fail('duplicate')),pull);await started.promise;
  assert.equal(f.status(),'pulling');assert.equal(state.busy,true);assert.ok(state.pull);
  const save=f.save(async()=>{order.push('save');return true});assert.equal(f.save(()=>assert.fail('duplicate')),save);
  g.resolve();assert.deepEqual(await Promise.all([pull,save]),[true,true]);assert.deepEqual(order,['pull','save']);
  assert.equal(state.busy,false);assert.equal(f.status(),'idle');assert.equal(f.status({online:false}),'offline');
  assert.equal(f.status({pending:{conflict:{}}}),'conflict');assert.equal(f.status({pending:{retry:{nextAttemptAt:'2099-01-01'}}}),'deferred');
});

test('bank snapshot fails closed if a mutation arrives in the final guard continuation',async()=>{
  let local=false,observations=0,writes=0;
  const bank=createDomainsBankController({model:{state:{bank:{}}},session:{connectionMode:'supabase'},checksSession:{},
    sharedChecksHaveLocalWork:()=>{observations++;if(observations===2)queueMicrotask(()=>{local=true});return local},
    syncSharedChecksFromCloud:async()=>true,saveSharedChecksToCloud:async()=>assert.fail('the mutation arrives after the drain check'),
    sharedChecksObservedSequence:()=>0,saveState:async()=>{writes++;return true},toast:noop,render:noop,bridge:{}});
  await assert.rejects(bank.commitBankSnapshot(1000),/לפני השמירה/);
  assert.equal(writes,0);
});

for(const app of ['orders','kupa']){
  for(const blocked of [false,true])test(`${app}: real bank refresh revalidates mutations made during bridge fetch (conflict=${blocked})`,async t=>{
    const f=fixture(app,t),fetched=gate(),release=gate(),published=[];
    const bankState={bank:{archiveInitialized:true,archiveVersion:2},checks:[]};f.cs.kupaCloudReadState=bankState;
    const bridge={getBridgeToken:()=> 'paired',status:async()=>({bridgeVersion:34,configured:true}),
      bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,creditAutoMode:()=> 'daily',autoEnabled:()=>false,
      fetchBalance:async()=>{fetched.resolve();await release.promise;return {fetchedAt:'2026-09-06T12:00:00Z',balance:1000,accountNumber:'123',branchNumber:'1',transactions:[]}}};
    const common={model:f.model,session:f.session,checksSession:f.cs,tab:{primaryTab:true},bridge,loadSession:()=>true,
      syncSharedChecksFromCloud:f.api.syncSharedChecksFromCloud,saveSharedChecksToCloud:f.api.saveSharedChecksToCloud,
      sharedChecksHaveLocalWork:()=>!!f.pending(),checksHaveLocalWork:()=>!!f.pending(),
      sharedChecksObservedSequence:()=>Math.max(0,...f.cs.sharedChecksBankEvents.map(e=>e.seq)),
      refreshFinanceCloudSnapshot:async()=>({verified:true,state:bankState}),refreshKupaReadout:async()=>true,
      readFinanceSyncDocument:async()=>({state:bankState}),saveState:async()=>true,
      saveBankSyncSnapshot:async(_state,_token,seq)=>{published.push(seq);return {saved:true}},
      syncBankTransactionsSnapshot:async()=>({sourcePayload:[]}),readBankTransactions:async()=>[],readBankTransactionSnapshot:async()=>null,
      toast:noop,render:noop};
    const controller=app==='orders'?createDomainsFinanceController(common):createDomainsBankController(common);
    const refresh=app==='orders'?controller.refreshBank():controller.refreshBankBalance();await fetched.promise;
    f.stage(50);if(blocked)f.pending().conflict={kind:'entity-conflict'};release.resolve();
    assert.equal(await refresh,!blocked);
    assert.deepEqual(published,blocked?[]:[42]);
    if(!blocked){assert.equal(f.pending(),null);assert.equal(f.head().state.checks[0].amount,50)}
  });
  for(const source of ['startup','poll'])test(`${app}: ${source} pull + bank verification shares one successful remote read`,async t=>{
    const f=fixture(app,t),g=f.holdRead();
    const pull=source==='startup'?f.api.syncSharedChecksFromCloud({quiet:true}):f.api.pollSharedChecks();
    await f.readStarted.promise;const bank=f.bank.commitBankSnapshot(1000);g.resolve();
    const results=await Promise.all([pull,bank]);if(source==='startup')assert.equal(results[0],true);
    assert.equal(results[1],true);assert.equal(f.calls.length,1);assert.equal(f.writes(),1);
  });
  test(`${app}: pull + save re-evaluates the latest durable generation`,async t=>{
    const f=fixture(app,t),g=f.holdRead(),pull=f.api.syncSharedChecksFromCloud();await f.readStarted.promise;
    f.stage(10);const save=f.api.saveSharedChecksToCloud('');f.stage(20);
    assert.equal(f.calls.length,1);g.resolve();assert.deepEqual(await Promise.all([pull,save]),[true,true]);
    const writes=f.calls.filter(x=>x[0]==='save');assert.equal(writes.length,1);assert.equal(writes[0][1][0].amount,20);
    assert.equal(writes[0][3],'op-'+f.cs[app==='orders'?'checksGeneration':'sharedChecksGeneration']);assert.equal(f.pending(),null);
  });
  test(`${app}: save + pull waits for ACK and reads a fresh revision`,async t=>{
    const f=fixture(app,t),g=f.holdAck();f.stage(20);const save=f.api.saveSharedChecksToCloud('');await f.saveStarted.promise;
    const pull=f.api.syncSharedChecksFromCloud({required:true}),joined=f.api.syncSharedChecksFromCloud();
    assert.equal(f.calls.filter(x=>x[0]==='read').length,1);g.resolve();
    assert.deepEqual(await Promise.all([save,pull,joined]),[true,true,true]);
    assert.deepEqual(f.calls.filter(x=>x[0]==='read').map(x=>x[1]),[7,8]);
  });
  for(const required of [false,true])test(`${app}: real pull failure reaches every joiner (required=${required})`,async t=>{
    t.mock.method(console,'error',noop);const f=fixture(app,t),g=f.holdRead(),error=new Error('remote unavailable');
    const a=f.api.syncSharedChecksFromCloud({required});await f.readStarted.promise;const b=f.api.syncSharedChecksFromCloud({required:true});
    const bank=f.bank.commitBankSnapshot(1000);const settled=Promise.allSettled([a,b,bank]);g.reject(error);
    const values=await settled;
    for(const v of values.slice(0,2))assert.ok(v.status==='rejected'?v.reason===error:v.value===false);
    assert.equal(values[2].status,'rejected');assert.equal(f.writes(),0);assert.equal(f.calls.length,1);assert.equal(f.api.sharedChecksSyncStatus(),'idle');
  });
  for(const blocked of ['conflict','retry'])test(`${app}: ${blocked} outbox blocks bank snapshot fail-closed`,async t=>{
    const f=fixture(app,t);f.stage(20,blocked==='conflict'?{conflict:{kind:'entity-conflict'}}:{retry:{nextAttemptAt:'2099-01-01T00:00:00Z'}});
    if(blocked==='conflict')f.pending().conflict={kind:'entity-conflict'};
    await assert.rejects(f.bank.commitBankSnapshot(1000));assert.equal(f.writes(),0);assert.equal(f.calls.length,0);assert.ok(f.pending());
    assert.equal(f.api.sharedChecksSyncStatus(),blocked==='conflict'?'conflict':'deferred');
  });
  for(const during of ['read','mirror'])test(`${app}: mutation during pull ${during} drains before bank watermark`,async t=>{
    const f=fixture(app,t),g=during==='read'?f.holdRead():f.holdMirror();
    if(during==='mirror')f.stage(10);
    const pull=f.api.syncSharedChecksFromCloud();await (during==='read'?f.readStarted.promise:f.mirrorStarted.promise);
    const bank=f.bank.commitBankSnapshot(1000);f.stage(30);g.resolve();await pull;
    assert.equal(await bank,true);assert.equal(f.head().state.checks[0].amount,30);assert.equal(f.pending(),null);
    assert.equal(f.model.state.bank.snapshotSeq,42);assert.equal(f.writes(),1);
  });
  test(`${app}: save queued behind pull rechecks session and network`,async t=>{
    const f=fixture(app,t),g=f.holdRead(),pull=f.api.syncSharedChecksFromCloud();await f.readStarted.promise;
    f.stage(20);const save=f.api.saveSharedChecksToCloud('');f.session.backendReady=false;g.resolve();
    await pull;assert.equal(await save,false);assert.equal(f.calls.filter(x=>x[0]==='save').length,0);assert.ok(f.pending());
  });
}

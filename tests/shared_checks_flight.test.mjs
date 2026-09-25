import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSharedChecks} from '../netunim-kupa/site/assets/js/domains/checks/model.js';
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
  let pending=null,head={revision:7,state:{checks:[],bankEvents:[]}},readGate=null,ackGate=null,mirrorGate=null,bankWrites=0,renders=0;
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
    writeStateToFolder:mirror,backupSnapshotToComputer:mirror,queueSharedChecksSave:noop,toast:noop,render:()=>{renders++},renderKupaDependentView:noop,
    recomputeKupaNetFromCache:noop,refreshCloudTimestamp:noop,refreshCloudHeaderTimestamp:noop,setSaveStatus:noop,setCloudHeaderStatus:noop};
  const api=(app==='orders'?ordersChecks:kupaChecks)(deps);
  // Real bank commit contract, driven by each app's real sync implementation.
  const bank=createDomainsBankController({model,session,checksSession:cs,sharedChecksHaveLocalWork:()=>!!pending,
    saveSharedChecksToCloud:api.saveSharedChecksToCloud,syncSharedChecksFromCloud:api.syncSharedChecksFromCloud,
    sharedChecksObservedSequence:()=>Math.max(0,...cs[prefix+'BankEvents'].map(e=>e.seq)),
    saveState:async()=>{bankWrites++;return true},toast:noop,render:noop,bridge:{}});
  return {api,bank,cs,session,model,calls,readStarted,saveStarted,mirrorStarted,stage,get,
    holdRead:()=>readGate=gate(),holdAck:()=>ackGate=gate(),holdMirror:()=>mirrorGate=gate(),
    renders:()=>renders,writes:()=>bankWrites,pending:()=>pending,head:()=>head};
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

test('Orders mirrors a remote shared-check update into V2 without writing a legacy browser snapshot',async()=>{
  const model={state:{checks:[]}},checksSession={checksCloudBase:[],checksGeneration:0},mirrored=[];
  const sync=ordersChecks({model,checksSession,files:{},tab:{primaryTab:true},
    loadSession:()=>true,getChecksPending:async()=>null,readSharedChecksCloud:async()=>({revision:8,state:{checks:[{id:'C',amount:25}],bankEvents:[]}}),
    refreshStorageV2CloudState:async()=>({seq:0}),replaceStorageV2CurrentState:async state=>{mirrored.push(clone(state));return 0},
    localSnapshot:()=>assert.fail('V2 remote mirror must not write the V1 snapshot'),persistChecksBase:noop,
    recomputeKupaNetFromCache:noop,refreshCloudTimestamp:noop,renderKupaDependentView:noop});
  assert.equal(await sync.syncSharedChecksFromCloud({quiet:true,required:true}),true);
  assert.equal(model.state.checks[0].id,'C');
  assert.equal(mirrored.length,1);
  assert.equal(mirrored[0].checks[0].amount,25);
});

test('Kupa mirrors a remote shared-check update into V2 and fails closed if its checkpoint fails',async t=>{
  t.mock.method(console,'error',()=>{});
  const model={state:{checks:[]}},checksSession={sharedChecksBase:[],sharedChecksBankEvents:[],sharedChecksGeneration:0},session={dbRevision:1},mirrored=[];
  let checkpointSucceeds=true;
  const sync=kupaChecks({model,checksSession,session,files:{},tab:{primaryTab:true},
    getSharedChecksPending:async()=>null,readSharedChecksDocument:async()=>({revision:8,state:{checks:[{id:'C',amount:25}],bankEvents:[]}}),
    refreshStorageV2CloudState:async()=>({seq:0}),replaceStorageV2CurrentState:async state=>{mirrored.push(clone(state));return checkpointSucceeds?0:false},
    persistImmediateBrowserSnapshot:()=>assert.fail('V2 remote mirror must not write the V1 snapshot'),persistSharedChecksBase:noop,
    setSaveStatus:noop,setCloudHeaderStatus:noop,refreshCloudHeaderTimestamp:noop});
  assert.equal(await sync.syncSharedChecksFromCloud({quiet:true,required:true}),true);
  assert.equal(mirrored[0].checks[0].amount,25);
  checkpointSucceeds=false;
  await assert.rejects(sync.syncSharedChecksFromCloud({quiet:true,required:true}),/storage_v2_shared_checks_mirror_failed/);
});

for(const app of ['orders','kupa'])test(`${app}: Storage V2 background check poll repaints only after a visible remote change`,async()=>{
  const model={state:{checks:[{id:'C',amount:10}]}},checksSession=app==='orders'?{checksCloudRevision:7,checksBankEvents:[]}:{sharedChecksRevision:7,sharedChecksBankEvents:[]},session={backendReady:true,connectionMode:'supabase'},tab={primaryTab:true};
  let renders=0,nextAmount=25;
  const sharedChecksV2={requested:true,primaryReady:true,lastRemoteUpdatedAt:'2026-09-25T03:00:00Z',
    async sync(){model.state.checks=[{id:'C',amount:nextAmount}];return true},
    async cloudState(){return {base:{revision:8,state:{checks:clone(model.state.checks),bankEvents:[]}},pending:false,control:null}}};
  const common={model,checksSession,session,tab,files:{},sharedChecksV2,toast:noop,refreshCloudTimestamp:noop,refreshCloudHeaderTimestamp:noop,setSaveStatus:noop,setCloudHeaderStatus:noop,recomputeKupaNetFromCache:noop};
  const sync=app==='orders'?ordersChecks({...common,loadSession:()=>true,renderKupaDependentView:()=>{renders++}}):kupaChecks({...common,render:()=>{renders++}});
  await sync.pollSharedChecks();assert.equal(renders,1,'the active checks-dependent view is repainted after V2 applies remote data');
  await sync.pollSharedChecks();assert.equal(renders,1,'an unchanged V2 poll does not cause a disruptive repaint');
});

test('Orders finance controller publishes automatic credit busy transitions without a manual view wrapper',async()=>{
  const started=gate(),release=gate(),states=[];
  const controller=createDomainsFinanceController({tab:{primaryTab:true},checksSession:{kupaCloudReadState:{}},
    bridge:{getBridgeToken:()=> 'paired',markCreditAttempt:noop,creditAutoEnabled:()=>true,creditAutoMode:()=> 'smart',creditAttemptReady:()=>true,bankAutoEnabled:()=>false,
      async creditStatus(){return {bridgeVersion:60,contractVersion:3,profiles:[{profileId:'p'}]}},async syncCreditCards(){return {profiles:[],errors:[]}}},
    loadSession:()=>true,refreshKupaReadout:async()=>{started.resolve();await release.promise;return false},syncSharedChecksFromCloud:async()=>true,saveSharedChecksToCloud:async()=>true,checksHaveLocalWork:()=>false,toast:noop});
  controller.setFinanceStatusListener(section=>states.push({section,creditBusy:controller.readSnapshot().creditBusy}));
  const refresh=controller.refreshCredit({auto:true});await started.promise;
  assert.deepEqual(states,[{section:'credit',creditBusy:true}],'auto credit sync publishes its busy state before the first await');
  release.resolve();assert.equal(await refresh,false);
  assert.deepEqual(states,[{section:'credit',creditBusy:true},{section:'credit',creditBusy:false}],'auto credit sync publishes its idle/error completion state too');
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
    const f=fixture(app,t),fetched=gate(),release=gate(),leaseRelease=gate(),leaseReleaseStarted=gate(),published=[];
    let bankRevisionTouches=0,controller=null;const statusStates=[];
    const bankState={bank:{archiveInitialized:true,archiveVersion:2},checks:[]};f.cs.kupaCloudReadState=bankState;
    const bridge={getBridgeToken:()=> 'paired',status:async()=>({bridgeVersion:55,configured:true}),
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
      claimFinanceSyncLease:async()=>({acquired:true}),releaseFinanceSyncLease:async()=>{leaseReleaseStarted.resolve();await leaseRelease.promise;return true},
      touchBankDataRevision:()=>{bankRevisionTouches++},toast:noop,render:noop};
    controller=app==='orders'?createDomainsFinanceController(common):createDomainsBankController(common);
    const onStatus=()=>{const state=controller.readSnapshot();statusStates.push({bankBusy:state.bankBusy,bankResultReady:state.bankResultReady})};
    if(app==='orders')controller.setFinanceStatusListener(section=>{assert.equal(section,'bank');onStatus()});
    const refresh=app==='orders'?controller.refreshBank():controller.refreshBankBalance();await fetched.promise;
    f.stage(50);if(blocked)f.pending().conflict={kind:'entity-conflict'};release.resolve();
    await leaseReleaseStarted.promise;
    if(app==='orders')assert.deepEqual(statusStates,[{bankBusy:true,bankResultReady:false},{bankBusy:true,bankResultReady:true}],'Orders publishes the busy transition immediately and exposes the finished outcome before waiting for remote lease cleanup');
    else{const state=controller.bankBridgeUiState();assert.equal(state.busy,true);assert.equal(state.resultReady,true,'Kupa exposes the finished outcome before waiting for remote lease cleanup')}
    assert.equal(bankRevisionTouches,app==='kupa'&&!blocked?1:0,'Kupa invalidates bank/bankFeed revisions only after an authoritative successful bank replacement');
    leaseRelease.resolve();
    assert.equal(await refresh,!blocked);
    if(app==='orders')assert.deepEqual(statusStates,[{bankBusy:true,bankResultReady:false},{bankBusy:true,bankResultReady:true},{bankBusy:false,bankResultReady:false}],'Orders publishes start, completed outcome, and unlocked idle state in order');
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

for(const app of ['orders','kupa'])test(`${app}: transient shared-check poll outage stays availability-only, while a real data error remains actionable`,async t=>{
  t.mock.method(console,'warn',noop);t.mock.method(console,'error',noop);
  const isOrders=app==='orders',errorKey=isOrders?'checksCloudLastError':'sharedChecksLastError',revisionKey=isOrders?'checksCloudRevision':'sharedChecksRevision';
  const state={[errorKey]:'',[revisionKey]:7},session={backendReady:true,connectionMode:'supabase'},model={state:{checks:[]}};
  let mode='transient';
  const readMeta=async()=>{const error=new Error(mode==='transient'?'temporary transport outage':'invalid shared checks payload');if(mode==='transient')error.code='SUPABASE_NETWORK_UNAVAILABLE';throw error};
  const deps={model,session,checksSession:state,tab:{primaryTab:true},loadSession:()=>({access_token:'x'}),checksHaveLocalWork:()=>false,sharedChecksHaveLocalWork:()=>false,
    readSharedChecksCloudMeta:readMeta,readSharedChecksMeta:readMeta,checksPendingExists:()=>false,sharedChecksPendingExists:()=>false};
  const api=(isOrders?ordersChecks:kupaChecks)(deps);
  await api.pollSharedChecks();assert.equal(state[errorKey],'','temporary network/backoff failures must not masquerade as a check-data integrity warning');
  mode='fatal';await api.pollSharedChecks();assert.match(state[errorKey],/invalid shared checks payload/,'non-transient read errors must remain actionable');
});


test('Kupa shared-check ACK and identical pull do not render; an authoritative remote change does',async t=>{
  const f=fixture('kupa',t);f.stage(20);
  f.model.state.checks=normalizeSharedChecks(f.model.state.checks);
  f.pending().snapshot=clone(f.model.state.checks);
  assert.equal(await f.api.saveSharedChecksToCloud(''),true);assert.equal(f.renders(),0);
  assert.equal(await f.api.syncSharedChecksFromCloud(),true);assert.equal(f.renders(),0);
  f.head().state.checks[0].amount=30;f.head().revision++;
  await f.api.pollSharedChecks();assert.equal(f.renders(),1);assert.equal(f.model.state.checks[0].amount,30);
});

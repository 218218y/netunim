import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedChecksV2Runtime} from '../shared/shared-checks-v2-runtime.js';
import {createSharedChecksV2Composition} from '../shared/shared-checks-v2-composition.js';
import {createSharedChecksStorageV2} from '../shared/shared-checks-storage-v2.js';
import {createSyncChecks as ordersChecks} from '../netunim-orders/site/assets/js/sync/checks.js';
import {createSyncChecks as kupaChecks} from '../netunim-kupa/site/assets/js/sync/checks.js';
import {createSyncChecksPersistence} from '../netunim-orders/site/assets/js/sync/checks-persistence.js';
import {createStoragePersistence} from '../netunim-kupa/site/assets/js/storage/persistence.js';
import {normalizeSharedChecks} from '../netunim-kupa/site/assets/js/domains/checks/model.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const clone=structuredClone,noop=()=>{},forbidden=()=>assert.fail('V1/Main write in Shared Checks primary');
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const state=(checks=[],bankEvents=[])=>({checks:normalizeSharedChecks(checks),bankEvents});
const put=id=>({type:'put',collection:'checks',id,mode:'replace'});
Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});

function fixture(site='orders',options={}){
  let owner='A',mode='primary',n=0,clean=true,visible=state([{id:'C',amount:100},{id:'D',amount:200}]);
  let head={revision:7,state:clone(visible)},rpcHook=null,readHook=null;
  const databases=new Map(),emergency=emergencyStore(),calls=[],ledger=new Map();
  const merge=(site==='orders'?ordersChecks:kupaChecks)({}).mergeSharedChecks;
  const create=()=>createSharedChecksV2Runtime({site,owner:()=>owner,primary:()=>true,mode:()=>mode,readState:()=>visible,applyState:value=>{visible=clone(value)},merge,
    verifyLegacyClean:async()=>{if(clean instanceof Error)throw clean;return clean},
    createStorage:args=>{if(!databases.has(owner))databases.set(owner,memoryDb());return createSharedChecksStorageV2({...args,db:databases.get(owner),emergency,...options})},
    operationId:()=>`flight-${++n}`,readRemote:async()=>readHook?readHook():clone(head),
    rpc:async(...args)=>{
      calls.push(clone(args));if(rpcHook)return rpcHook(...args);
      const [checks,revision,id]=args;
      if(ledger.has(id))return {r:{ok:true},row:clone(head)};
      if(revision!==head.revision)return {r:{ok:false,status:409},j:{code:'PT409',message:'revision_conflict'}};
      head={revision:revision+1,state:{checks:clone(checks),bankEvents:[{seq:42,checkId:'C',delta:100}]}};ledger.set(id,clone(head));return {r:{ok:true},row:clone(head)};
    }});
  return {create,calls,databases,ledger,get visible(){return visible},set visible(value){visible=value},get head(){return head},set head(value){head=value},
    set owner(value){owner=value},set mode(value){mode=value},set clean(value){clean=value},set rpcHook(value){rpcHook=value},set readHook(value){readHook=value},
    async start(){const runtime=create();await runtime.initialize({state:visible,revision:7,intent:'legacy-upgrade',sourceOwner:'A'});return runtime},
    edit(runtime,id,values){visible.checks=visible.checks.map(row=>row.id===id?{...row,...values}:row);return runtime.persist([put(id)],{generation:++n})}};
}

for(const site of ['orders','kupa']){
  test(`${site}: account cutover routes Shared polling to V2 before recovery`,()=>{
    const prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
    Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>key===`netunim-storage-cutover-version:${site}:A`?'2':null}});
    try{
      const composition=createSharedChecksV2Composition({site,owner:()=> 'A',primary:()=>true,
        model:{state:{checks:[]}},checksSession:{checksBankEvents:[],sharedChecksBankEvents:[]},eventsKey:site==='orders'?'checksBankEvents':'sharedChecksBankEvents',
        domainRevisions:{touch:noop},merge:noop,readRemote:async()=>null,rpc:async()=>null,
        verifyLegacyClean:async()=>true,main:{setBoundaryGate:noop}});
      assert.equal(composition.runtime.requested,true);
      assert.equal(composition.runtime.primaryReady,false);
    }finally{
      if(prior)Object.defineProperty(globalThis,'localStorage',prior);
      else delete globalThis.localStorage;
    }
  });
  test(`${site}: Shared V2 publishes the server timestamp without another metadata read`,async()=>{
    const f=fixture(site),runtime=await f.start();
    f.head={...f.head,updated_at:'2026-09-24T10:20:00Z'};
    assert.equal(await runtime.sync(),true);
    assert.equal(runtime.lastRemoteUpdatedAt,'2026-09-24T10:20:00Z');
  });
  test(`${site}: local Shared Checks survives edit and restart without a cloud cursor`,async()=>{
    const f=fixture(site);f.owner='local';
    let runtime=f.create();await runtime.initializeLocal({state:f.visible});
    assert.equal(runtime.localReady,true);assert.equal(runtime.cloudReady,false);
    assert.equal((await runtime.cloudState()).base,null);
    await f.edit(runtime,'C',{note:'local only'}).committed;
    runtime=f.create();await runtime.recover();
    assert.equal(f.visible.checks[0].note,'local only');
    assert.equal(runtime.localReady,true);assert.equal(runtime.cloudReady,false);
    await assert.rejects(runtime.sync(),/shared_checks_cursor_missing/);
    assert.equal((await runtime.cloudState()).control,null);
    assert.equal(f.calls.length,0,'a local journal must not issue an RPC');
  });
  test(`${site}: single shared journal recovers edit/deposit/return/delete without a Main write`,async()=>{
    const f=fixture(site);let runtime=await f.start();
    for(const status of ['הופקד - במעקב','חזר']){
      await f.edit(runtime,'C',{status}).committed;runtime=f.create();await runtime.recover();assert.equal(f.visible.checks[0].status,status);
    }
    f.visible.checks=f.visible.checks.filter(row=>row.id!=='C');await runtime.persist([{type:'delete',collection:'checks',id:'C'}],{deleteIds:['C']}).committed;
    runtime=f.create();await runtime.recover();assert.equal(f.visible.checks.length,1);assert.deepEqual((await runtime.cloudState()).pendingDeleteIntents,{checks:['C']});
    assert.equal(await runtime.sync(),true);assert.deepEqual(f.calls[0][3],['C']);
    runtime=f.create();await runtime.recover();assert.equal(f.visible.bankEvents[0].seq,42);assert.equal((await runtime.cloudState()).pending,false);
  });
  test(`${site}: lost ACK retries identical operation and payload across restart`,async()=>{
    const f=fixture(site);let runtime=await f.start();await f.edit(runtime,'C',{status:'הופקד - במעקב'}).committed;
    f.rpcHook=async(checks,revision,id)=>{f.head={revision:revision+1,state:state(checks,[{seq:42,checkId:'C',delta:100}])};f.ledger.set(id,clone(f.head));throw new TypeError('Failed to fetch')};
    await assert.rejects(runtime.sync(),/fetch/);const first=clone(f.calls[0]);
    runtime=f.create();await runtime.recover();await f.edit(runtime,'D',{note:'during outage'}).committed;f.rpcHook=null;
    assert.equal(await runtime.sync(),true);assert.deepEqual(f.calls[1],first);assert.equal(f.visible.checks[1].note,'during outage');
    assert.notEqual(f.calls[2][2],first[2]);assert.equal(f.visible.bankEvents[0].seq,42);
  });
  test(`${site}: confirmed conflict durably rebases remote check and event before replacement flight`,async()=>{
    const f=fixture(site),runtime=await f.start();await f.edit(runtime,'C',{note:'local'}).committed;
    f.head={revision:8,state:state([{...f.head.state.checks[0]},{...f.head.state.checks[1],note:'remote'}],[{seq:9,checkId:'D',delta:200}])};
    let rejected=false;f.rpcHook=async()=>{if(!rejected){rejected=true;return {r:{ok:false,status:409},j:{code:'PT409',message:'revision_conflict'}}}throw new TypeError('Failed to fetch')};
    await assert.rejects(runtime.sync(),/fetch/);
    const restarted=f.create();await restarted.recover();assert.equal(f.visible.checks[0].note,'local');assert.equal(f.visible.checks[1].note,'remote');assert.equal(f.visible.bankEvents[0].seq,9);
    assert.notEqual(f.calls[0][2],f.calls[1][2]);assert.equal(f.calls[1][1],8);
  });
  test(`${site}: same-check conflict remains blocked across restart`,async()=>{
    const f=fixture(site),runtime=await f.start();await f.edit(runtime,'C',{note:'local'}).committed;
    f.head={revision:8,state:state([{...f.head.state.checks[0],note:'remote'},f.head.state.checks[1]])};
    assert.equal(await runtime.sync(),false);assert.equal(f.visible.checks[0].note,'local');
    const restarted=f.create();await restarted.recover();assert.ok((await restarted.cloudState()).control.conflict);assert.equal(await restarted.sync(),false);assert.equal(f.calls.length,1);
  });
  test(`${site}: an edit during RPC is retained by atomic ACK`,async()=>{
    const f=fixture(site),runtime=await f.start(),entered=gate(),release=gate();await f.edit(runtime,'C',{note:'first'}).committed;
    f.rpcHook=async(checks,revision)=>{entered.resolve();await release.promise;f.rpcHook=null;f.head={revision:revision+1,state:state(checks,[{seq:42,checkId:'C'}])};return {r:{ok:true},row:clone(f.head)}};
    const sync=runtime.sync();await entered.promise;await f.edit(runtime,'D',{note:'later'}).committed;release.resolve();assert.equal(await sync,true);
    assert.equal(f.calls.length,2);assert.equal(f.visible.checks[1].note,'later');
  });
}

test('account handoff fences outstanding RPC, loads only the target namespace and requires explicit provenance',async()=>{
  const f=fixture(),runtime=await f.start(),entered=gate(),release=gate();await f.edit(runtime,'C',{note:'A edit'}).committed;
  f.rpcHook=async()=>{entered.resolve();await release.promise;return {r:{ok:true},row:{revision:8,state:state([])}}};
  const sync=runtime.sync();await entered.promise;f.owner='B';assert.equal(runtime.primaryReady,false);
  assert.equal(await runtime.recover(),null);assert.throws(()=>runtime.persist([put('C')]),/not_recovered/);
  await assert.rejects(runtime.initialize({state:f.visible,revision:7,intent:'legacy-upgrade',sourceOwner:'A'}),/transfer_intent/);
  await runtime.initialize({state:state([{id:'B',amount:999}]),revision:4,intent:'cloud-authoritative',sourceOwner:'B'});
  release.resolve();await assert.rejects(sync,/handoff/);assert.equal(f.visible.checks[0].id,'B');
  f.owner='A';await runtime.recover();assert.equal(f.visible.checks[0].note,'A edit');assert.ok((await runtime.cloudState()).flight);
});

test('initialization refuses unreadable or pending V1 and never mutates the new namespace',async()=>{
  for(const clean of [false,new Error('IDB unavailable')]){
    const f=fixture(),runtime=f.create();f.clean=clean;
    await assert.rejects(runtime.initialize({state:f.visible,revision:7,intent:'legacy-upgrade',sourceOwner:'A'}));
    assert.equal((await f.databases.get('A').load()).checkpoints,null);
  }
});

test('first document atomically recovers its initial upload without a legacy outbox',async()=>{
  const f=fixture(),runtime=f.create();f.head={revision:0,state:state([])};
  await runtime.initialize({state:f.visible,revision:0,intent:'upload-local',sourceOwner:'local'});
  const restarted=f.create();await restarted.recover();assert.equal(f.visible.checks.length,2);assert.equal((await restarted.cloudState()).pending,true);
  assert.equal(await restarted.sync(),true);assert.equal(f.calls[0][1],0);assert.equal(f.calls[0][0].length,2);
});

test('an empty first document still has one durable pending operation',async()=>{
  const f=fixture(),runtime=f.create();f.head={revision:0,state:state([])};
  await runtime.initialize({state:state([]),revision:0,intent:'upload-local',sourceOwner:'local'});
  assert.equal(await runtime.sync(),true);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0][0],[]);
});

test('Shared Checks preparation mode permits bootstrap/sync but freezes user mutations',async()=>{
  const f=fixture(),runtime=f.create();f.mode='preparing';f.head={revision:0,state:state([])};
  await runtime.initialize({state:f.visible,revision:0,intent:'upload-owner',sourceOwner:'A'});
  assert.equal(runtime.requested,true);assert.equal(runtime.primaryReady,true);
  assert.throws(()=>runtime.persist([put('C')],{generation:1}),/preparation_locked/);
  assert.equal(await runtime.sync(),true);assert.equal((await runtime.cloudState()).pending,false);
});

test('Shared Checks bootstrap initialization is restart-idempotent for the same operation id only',async()=>{
  const f=fixture(),runtime=f.create();f.mode='preparing';f.head={revision:0,state:state([])};
  await runtime.initialize({state:f.visible,revision:0,intent:'upload-owner',sourceOwner:'A',bootstrapOperationId:'group:shared'});
  const restarted=f.create();
  const recovered=await restarted.initialize({state:f.visible,revision:0,intent:'upload-owner',sourceOwner:'A',bootstrapOperationId:'group:shared'});
  assert.equal(recovered.seq,1);
  await assert.rejects(f.create().initialize({state:f.visible,revision:0,intent:'upload-owner',sourceOwner:'A',bootstrapOperationId:'other:shared'}),/existing_head_mismatch/);
});

for(const site of ['orders','kupa'])test(`${site}: application save and RPC adapters never invoke Main or V1 in primary`,async t=>{
  t.mock.method(globalThis,'setTimeout',()=>0);
  const f=fixture(site),runtime=await f.start(),checksSession={checksGeneration:0,sharedChecksGeneration:0},session={localGeneration:0,connectionMode:'supabase',backendReady:true};
  const model={get state(){return f.visible}},common={model,session,checksSession,tab:{primaryTab:true},files:{},sharedChecksV2:runtime,domainRevisions:{touch:noop},
    localSnapshot:forbidden,persistImmediateBrowserSnapshot:forbidden,markChecksPending:forbidden,markSharedChecksPending:forbidden,
    toast:noop,setSave:noop,setSaveStatus:noop,setCloudHeaderStatus:noop,folderSaveTitle:()=>'',rejectSecondaryMutation:()=>false,loadSession:()=>true,
    observeSharedChecks:forbidden,saveSharedChecksToCloud:noop};
  const persistence=site==='orders'?createSyncChecksPersistence(common):createStoragePersistence(common);
  f.visible.checks[0].note='app edit';const result=site==='orders'?persistence.scheduleCheckSave('edit',{operations:[put('C')]}):await persistence.saveChecksState('edit',{operations:[put('C')]});assert.equal(result,true);
  await runtime.flush();
  const sync=(site==='orders'?ordersChecks:kupaChecks)({...common,refreshStorageV2CloudState:forbidden,replaceStorageV2CurrentState:forbidden,persistChecksBase:forbidden,persistSharedChecksBase:forbidden,
    getChecksPending:forbidden,getSharedChecksPending:forbidden,render:noop,renderKupaDependentView:noop,recomputeKupaNetFromCache:noop,refreshCloudTimestamp:noop,refreshCloudHeaderTimestamp:noop});
  assert.equal(await sync.saveSharedChecksToCloud(),true);assert.equal(f.calls[0][0][0].note,'app edit');
});

test('Shared Checks bootstrap atomically promotes an identical shadow namespace',async()=>{
  const f=fixture(),db=memoryDb(),emergency=emergencyStore();
  f.databases.set('A',db);
  const shadow=createSharedChecksStorageV2({owner:()=> 'A',primary:()=>true,role:'shadow',db,emergency});
  await shadow.open({migrationState:f.visible,migrationIntent:'shadow-observation',sourceOwner:'A'});
  assert.equal((await db.load('A:shared-checks')).bases,null);

  f.mode='preparing';f.head={revision:0,state:state([])};
  const runtime=f.create();
  const recovered=await runtime.initialize({state:f.visible,revision:0,intent:'upload-owner',sourceOwner:'A',bootstrapOperationId:'shadow-promote:shared'});
  assert.equal(recovered.seq,1);assert.deepEqual(recovered.state,f.visible);
  const stored=await db.load('A:shared-checks');assert.equal(stored.bases.data.revision,0);assert.equal(stored.metadata.seq,1);assert.equal(stored.journal.length,1);
  const cloud=await runtime.cloudState();assert.equal(cloud.pending,true);assert.equal(cloud.base.ackSeq,0);
});

test('Shared Checks bootstrap refuses divergent shadow promotion and preserves the shadow',async()=>{
  const f=fixture(),db=memoryDb(),emergency=emergencyStore();
  f.databases.set('A',db);
  const shadowState=state([{id:'shadow-only',amount:1}]);
  const shadow=createSharedChecksStorageV2({owner:()=> 'A',primary:()=>true,role:'shadow',db,emergency});
  await shadow.open({migrationState:shadowState,migrationIntent:'shadow-observation',sourceOwner:'A'});
  f.mode='preparing';f.head={revision:0,state:state([])};
  await assert.rejects(f.create().initialize({state:f.visible,revision:0,intent:'upload-owner',sourceOwner:'A',bootstrapOperationId:'shadow-mismatch:shared'}),/existing_head_mismatch/);
  const stored=await db.load('A:shared-checks');assert.equal(stored.bases,null);assert.equal(stored.journal.length,0);assert.deepEqual(stored.checkpoints.data.state,shadowState);
});

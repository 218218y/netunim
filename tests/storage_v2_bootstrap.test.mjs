import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createStorageV2BootstrapCoordinator,createStorageV2BootstrapExecutor,createStorageV2BootstrapGroup,STORAGE_BOOTSTRAP_PHASES} from '../shared/storage-v2-bootstrap.js';

function state(id){return {rows:id?[{id,value:id}]:[]}}
function sharedState(id){return {checks:id?[{id,value:id}]:[],bankEvents:[]}}
function fakeDb(){
  const groups=new Map();
  return {
    async readBootstrapGroup(scope){return groups.has(scope)?structuredClone(groups.get(scope)):null},
    async beginBootstrapGroup(scope,record){
      const current=groups.get(scope);
      if(current&&current.phase!=='complete'){
        if(current.id===record.id&&current.planHash===record.planHash)return structuredClone(current);
        throw new Error('storage_bootstrap_group_pending');
      }
      groups.set(scope,structuredClone(record));return structuredClone(record);
    },
    async advanceBootstrapGroup(scope,id,from,to,patch){
      const current=groups.get(scope);if(!current)throw new Error('storage_bootstrap_group_missing');
      if(current.id!==id||current.phase!==from)throw new Error('storage_bootstrap_group_changed');
      const next={...current,...structuredClone(patch),phase:to};groups.set(scope,next);return structuredClone(next);
    },
  };
}
const sources={mainSource:{seq:7,state:state('main-local')},sharedSource:{seq:4,state:sharedState('shared-local')}};
const remotes={mainRemote:{revision:11,state:state('main-cloud')},sharedRemote:{revision:9,state:sharedState('shared-cloud')}};
const matchingMainRemote={revision:11,state:state('main-local')};
const matchingSharedRemote={revision:9,state:sharedState('shared-local')};

for(const [name,mainRemote,sharedRemote,expected] of [
  ['both exist',matchingMainRemote,matchingSharedRemote,['cloud-authoritative','cloud-authoritative']],
  ['main missing',null,matchingSharedRemote,['upload-owner','cloud-authoritative']],
  ['shared missing',matchingMainRemote,null,['cloud-authoritative','upload-owner']],
  ['both missing',null,null,['upload-owner','upload-owner']],
])test(`bootstrap first-cloud plan: ${name}`,async()=>{
  const group=await createStorageV2BootstrapGroup({app:'orders',owner:'account-A',sourceOwner:'account-A',transferIntent:'first-cloud',...sources,mainRemote,sharedRemote,id:`00000000-0000-4000-8000-${name.replaceAll(' ','').padEnd(12,'0').slice(0,12)}`,now:()=> '2026-09-23T12:00:00.000Z',cryptoImpl:webcrypto});
  assert.equal(group.transferIntent,'first-cloud');assert.equal(group.main.intent,expected[0]);assert.equal(group.shared.intent,expected[1]);
  for(const side of [group.main,group.shared]){
    if(side.remoteExists){assert.ok(side.remoteRevision>0);assert.match(side.remoteHash,/^[0-9a-f]{64}$/)}
    else{assert.equal(side.remoteRevision,0);assert.equal(side.remoteHash,null);assert.equal(side.intent,'upload-owner')}
  }
});

test('bootstrap local upload may create only actually missing documents and refuses an existing Main target',async()=>{
  const group=await createStorageV2BootstrapGroup({app:'orders',owner:'account-B',sourceOwner:'local',transferIntent:'upload-local',...sources,mainRemote:null,sharedRemote:matchingSharedRemote,id:'local-upload',cryptoImpl:webcrypto});
  assert.equal(group.main.intent,'upload-local');assert.equal(group.shared.intent,'cloud-authoritative');
  await assert.rejects(createStorageV2BootstrapGroup({app:'orders',owner:'account-B',sourceOwner:'local',transferIntent:'upload-local',...sources,...remotes,id:'local-existing',cryptoImpl:webcrypto}),/upload_target_exists/);
});

test('in-place first-cloud/legacy upgrade stops on a divergent existing Main document',async()=>{
  await assert.rejects(createStorageV2BootstrapGroup({app:'orders',owner:'account-A',sourceOwner:'account-A',transferIntent:'first-cloud',...sources,mainRemote:remotes.mainRemote,sharedRemote:matchingSharedRemote,id:'main-divergence-first',cryptoImpl:webcrypto}),/main_reconciliation_required/);
  await assert.rejects(createStorageV2BootstrapGroup({app:'orders',owner:'account-A',sourceOwner:'account-A',transferIntent:'legacy-upgrade',...sources,mainRemote:remotes.mainRemote,sharedRemote:matchingSharedRemote,id:'main-divergence-legacy',cryptoImpl:webcrypto}),/main_reconciliation_required/);
});

test('bootstrap stops instead of silently replacing divergent existing Shared Checks',async()=>{
  await assert.rejects(createStorageV2BootstrapGroup({app:'orders',owner:'account-A',sourceOwner:'account-A',transferIntent:'first-cloud',...sources,mainRemote:null,sharedRemote:remotes.sharedRemote,id:'shared-divergence',cryptoImpl:webcrypto}),/shared_reconciliation_required/);
  await assert.rejects(createStorageV2BootstrapGroup({app:'orders',owner:'account-B',sourceOwner:'local',transferIntent:'upload-local',...sources,mainRemote:null,sharedRemote:remotes.sharedRemote,id:'shared-divergence-local',cryptoImpl:webcrypto}),/shared_reconciliation_required/);
});

test('load-account and account-switch never seed a missing target document from the visible source account',async()=>{
  await assert.rejects(createStorageV2BootstrapGroup({app:'orders',owner:'account-B',sourceOwner:'local',transferIntent:'load-account',...sources,mainRemote:null,sharedRemote:remotes.sharedRemote,id:'load-missing-main',cryptoImpl:webcrypto}),/main_remote_missing/);
  await assert.rejects(createStorageV2BootstrapGroup({app:'orders',owner:'account-B',sourceOwner:'local',transferIntent:'load-account',...sources,mainRemote:remotes.mainRemote,sharedRemote:null,id:'load-missing-shared',cryptoImpl:webcrypto}),/shared_remote_missing/);
  const switched=await createStorageV2BootstrapGroup({app:'orders',owner:'account-B',sourceOwner:'account-A',transferIntent:'account-switch',...sources,...remotes,id:'switch-existing',cryptoImpl:webcrypto});
  assert.equal(switched.main.intent,'cloud-authoritative');assert.equal(switched.shared.intent,'cloud-authoritative');
  await assert.rejects(createStorageV2BootstrapGroup({app:'orders',owner:'account-B',sourceOwner:'account-A',transferIntent:'account-switch',...sources,mainRemote:remotes.mainRemote,sharedRemote:null,id:'switch-missing-shared',cryptoImpl:webcrypto}),/shared_remote_missing/);
});

test('bootstrap coordinator is restartable and phase order is strict',async()=>{
  const db=fakeDb(),owner=()=> 'account-A',common={app:'kupa',owner,primary:()=>true,db,cryptoImpl:webcrypto,operationId:()=> '11111111-1111-4111-8111-111111111111'};
  const first=createStorageV2BootstrapCoordinator(common);
  let group=await first.prepare({...sources,mainRemote:null,sharedRemote:matchingSharedRemote,sourceOwner:'account-A',transferIntent:'first-cloud'});
  assert.equal(group.phase,'prepared');assert.equal(group.main.intent,'upload-owner');assert.equal(group.shared.intent,'cloud-authoritative');
  group=await first.advance('prepared',{mainRevision:0});assert.equal(group.phase,'main-initialized');
  const afterRestart=createStorageV2BootstrapCoordinator(common),resumed=await afterRestart.load();
  assert.equal(resumed.id,group.id);assert.equal(resumed.planHash,group.planHash);assert.equal(resumed.phase,'main-initialized');
  await assert.rejects(()=>afterRestart.advance('prepared'),/storage_bootstrap_phase_invalid/);
  for(const phase of STORAGE_BOOTSTRAP_PHASES.slice(1,-1))group=await afterRestart.advance(phase);
  assert.equal(group.phase,'complete');
});


test('bootstrap prepare is idempotent across restart when remote discovery is unchanged',async()=>{
  const db=fakeDb(),owner=()=> 'account-A';
  const first=createStorageV2BootstrapCoordinator({app:'orders',owner,primary:()=>true,db,cryptoImpl:webcrypto,operationId:()=> '44444444-4444-4444-8444-444444444444'});
  const prepared=await first.prepare({...sources,mainRemote:null,sharedRemote:matchingSharedRemote,sourceOwner:'account-A',transferIntent:'first-cloud'});
  await first.advance('prepared',{mainInitialized:true});
  const restarted=createStorageV2BootstrapCoordinator({app:'orders',owner,primary:()=>true,db,cryptoImpl:webcrypto,operationId:()=> '55555555-5555-4555-8555-555555555555'});
  const resumed=await restarted.prepare({...sources,mainRemote:null,sharedRemote:matchingSharedRemote,sourceOwner:'account-A',transferIntent:'first-cloud'});
  assert.equal(resumed.id,prepared.id);assert.equal(resumed.phase,'main-initialized');assert.equal(resumed.planHash,prepared.planHash);
});
test('pending bootstrap plan cannot be silently replaced after remote discovery changes',async()=>{
  const db=fakeDb(),owner=()=> 'account-A';
  const first=createStorageV2BootstrapCoordinator({app:'orders',owner,primary:()=>true,db,cryptoImpl:webcrypto,operationId:()=> '22222222-2222-4222-8222-222222222222'});
  await first.prepare({...sources,mainRemote:null,sharedRemote:null,sourceOwner:'account-A',transferIntent:'first-cloud'});
  const second=createStorageV2BootstrapCoordinator({app:'orders',owner,primary:()=>true,db,cryptoImpl:webcrypto,operationId:()=> '33333333-3333-4333-8333-333333333333'});
  await assert.rejects(()=>second.prepare({...sources,mainRemote:matchingMainRemote,sharedRemote:null,sourceOwner:'account-A',transferIntent:'first-cloud'}),/storage_bootstrap_group_pending/);
});

test('completed bootstrap proof is reused only for the identical plan and is replaced for a later plan',async()=>{
  const db=fakeDb(),owner=()=> 'account-A',ids=['77777777-7777-4777-8777-777777777777','88888888-8888-4888-8888-888888888888'];
  const make=()=>createStorageV2BootstrapCoordinator({app:'orders',owner,primary:()=>true,db,cryptoImpl:webcrypto,operationId:()=>ids.shift()});
  const first=make(),options={...sources,mainRemote:null,sharedRemote:null,sourceOwner:'account-A',transferIntent:'first-cloud'};
  let group=await first.prepare(options);
  for(const phase of STORAGE_BOOTSTRAP_PHASES.slice(0,-1))group=await first.advance(phase);
  assert.equal(group.phase,'complete');const firstId=group.id,firstHash=group.planHash;
  const identical=await make().prepare(options);
  assert.equal(identical.id,firstId);assert.equal(identical.planHash,firstHash,'identical immutable plan may reuse completed proof');
  const changed=await make().prepare({...options,mainSource:{seq:8,state:state('main-local-new')}});
  assert.notEqual(changed.id,firstId);assert.notEqual(changed.planHash,firstHash);assert.equal(changed.phase,'prepared');assert.equal(changed.main.sourceSeq,8);
});

test('bootstrap executor resumes exactly the interrupted durable phase after a crash',async()=>{
  const db=fakeDb(),owner=()=> 'account-A',coordinator=()=>createStorageV2BootstrapCoordinator({app:'orders',owner,primary:()=>true,db,cryptoImpl:webcrypto,operationId:()=> '66666666-6666-4666-8666-666666666666'});
  const calls=[];let failSharedSync=true;
  const makeExecutor=()=>createStorageV2BootstrapExecutor({
    coordinator:coordinator(),primary:()=>true,
    initializeMain:async side=>{calls.push(`main-init:${side.operationId}`);return {revision:0}},
    initializeShared:async side=>{calls.push(`shared-init:${side.operationId}`);return {revision:9}},
    syncMain:async()=>{calls.push('main-sync');return {revision:1}},
    syncShared:async()=>{calls.push('shared-sync');if(failSharedSync){failSharedSync=false;throw new Error('simulated-crash')}return {revision:9}},
    verify:async()=>{calls.push('verify');return {clean:true}},
  });
  const options={...sources,mainRemote:null,sharedRemote:matchingSharedRemote,sourceOwner:'account-A',transferIntent:'first-cloud'};
  await assert.rejects(()=>makeExecutor().start(options),/simulated-crash/);
  assert.deepEqual(calls,['main-init:66666666-6666-4666-8666-666666666666:main','shared-init:66666666-6666-4666-8666-666666666666:shared','main-sync','shared-sync']);
  const done=await makeExecutor().resume();
  assert.equal(done.phase,'complete');
  assert.deepEqual(calls,['main-init:66666666-6666-4666-8666-666666666666:main','shared-init:66666666-6666-4666-8666-666666666666:shared','main-sync','shared-sync','shared-sync','verify']);
});


test('Shared bootstrap parity ignores cloud envelope metadata but not business data',async()=>{
  const owner='account-a';
  const local={checks:[{id:'c1',amount:100}],bankEvents:[{id:'e1',type:'deposit'}]};
  const remote={version:1,checks:[{id:'c1',amount:100}],bankEvents:[{id:'e1',type:'deposit'}],transportHint:'ignored'};
  const group=await createStorageV2BootstrapGroup({app:'orders',owner,sourceOwner:owner,transferIntent:'first-cloud',mainSource:{seq:1,state:state('main')},sharedSource:{seq:2,state:local},mainRemote:{revision:3,state:state('main')},sharedRemote:{revision:4,state:remote},id:'bootstrap-envelope',cryptoImpl:webcrypto});
  assert.equal(group.shared.intent,'cloud-authoritative');
  assert.equal(group.shared.sourceHash,group.shared.remoteHash);
  const changed={...remote,bankEvents:[{id:'e1',type:'returned'}]};
  await assert.rejects(()=>createStorageV2BootstrapGroup({app:'orders',owner,sourceOwner:owner,transferIntent:'first-cloud',mainSource:{seq:1,state:state('main')},sharedSource:{seq:2,state:local},mainRemote:{revision:3,state:state('main')},sharedRemote:{revision:4,state:changed},id:'bootstrap-envelope-changed',cryptoImpl:webcrypto}),/storage_bootstrap_shared_reconciliation_required/);
});


test('bootstrap state can be hydrated read-only in a secondary tab, while mutation still requires primary',async()=>{
  const db=fakeDb(),owner=()=> 'account-A';
  const primary=createStorageV2BootstrapCoordinator({app:'orders',owner,primary:()=>true,db,cryptoImpl:webcrypto,operationId:()=> '77777777-7777-4777-8777-777777777777'});
  const prepared=await primary.prepare({...sources,mainRemote:null,sharedRemote:null,sourceOwner:'account-A',transferIntent:'first-cloud'});
  const secondary=createStorageV2BootstrapCoordinator({app:'orders',owner,primary:()=>false,db,cryptoImpl:webcrypto});
  const hydrated=await secondary.load();
  assert.equal(hydrated.id,prepared.id);assert.equal(hydrated.phase,'prepared');assert.equal(secondary.hasGroup,true);
  await assert.rejects(()=>secondary.advance('prepared'),/storage_bootstrap_primary_required/);
});

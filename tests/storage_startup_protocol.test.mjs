import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageStartupProtocol} from '../shared/storage-startup-protocol.js';
import {createKupaStorageV2Coordinator} from '../netunim-kupa/site/assets/js/composition/storage-v2.js';
import {createOrdersStorageV2Coordinator} from '../netunim-orders/site/assets/js/composition/storage-v2.js';

function fixture({owner='account',authenticated='account',accountMarker=false,localMarker=false,server={orders:2,kupa:2,sharedChecks:2},failure=null,installMarker=true}={}){
  const calls=[];
  const runtime=createStorageStartupProtocol({
    ownership:{current:()=>owner,authenticated:()=>authenticated},
    markers:{account:async()=>{calls.push('account-marker');return accountMarker},local:async()=>{calls.push('local-marker');return localMarker}},
    account:{read:async()=>{calls.push('server');if(server instanceof Error)throw server;return server},
      recoverAccount:async()=>{calls.push('adopt');if(failure)throw failure;owner='account';accountMarker=installMarker}},
  });
  return {runtime,calls};
}

test('startup protocol validates its ownership, marker and account contracts before any I/O',()=>{
  for(const [key,method] of [['ownership','authenticated'],['markers','local'],['account','recoverAccount']]){
    const ports={ownership:{current:()=>null,authenticated:()=>null},markers:{account:async()=>false,local:async()=>false},account:{read:async()=>null,recoverAccount:async()=>false}};
    delete ports[key][method];
    assert.throws(()=>createStorageStartupProtocol(ports),new RegExp(`startup_protocol_${key}_${method}_required`));
  }
});

test('local birth and durable V2 markers make no server request while offline',async()=>{
  for(const options of [
    {owner:'local',authenticated:null},
    {owner:'local',authenticated:null,localMarker:true},
    {accountMarker:true},
  ]){
    const f=fixture(options),decision=await f.runtime.check({primary:true,online:false});
    assert.equal(decision.protocol.allowed,true);
    assert.deepEqual(f.calls,['account-marker','local-marker']);
  }
});

test('unmarked offline or mismatched account never reads or adopts a server head',async()=>{
  for(const [options,online] of [[{},false],[{authenticated:'another-account'},true]]){
    const f=fixture(options),decision=await f.runtime.check({primary:true,online});
    assert.deepEqual(decision.protocol,{allowed:false,reason:'verification-required'});
    assert.deepEqual(f.calls,['account-marker','local-marker']);
  }
});

test('legacy, inconsistent and unavailable server protocols remain blocked without recovery',async()=>{
  for(const [server,reason] of [
    [{orders:1,kupa:1,sharedChecks:1},'upgrade-required'],
    [{orders:2,kupa:1,sharedChecks:2},'protocol-inconsistent'],
    [new Error('offline'),'verification-required'],
  ]){
    const f=fixture({server}),decision=await f.runtime.check({primary:true,online:true});
    assert.deepEqual(decision.protocol,{allowed:false,reason});
    assert.deepEqual(f.calls,['account-marker','local-marker','server']);
  }
});

test('fenced recovery must install a durable marker before allowing startup with the current owner',async()=>{
  const f=fixture({owner:'local'}),decision=await f.runtime.check({primary:true,online:true});
  assert.deepEqual(decision.protocol,{allowed:true,reason:'v2-ready'});
  assert.equal(decision.owner,'account');
  assert.equal(decision.accountV2Active,true);
  assert.equal(decision.recoveryError,null);
  assert.deepEqual(f.calls,['account-marker','local-marker','server','adopt','account-marker']);
  assert.deepEqual(await f.runtime.readMarkers(),{owner:'account',accountV2Active:true,localEngineActive:false});
});

test('secondary startup cannot perform fenced adoption',async()=>{
  const f=fixture(),decision=await f.runtime.check({primary:false,online:true});
  assert.deepEqual(decision.protocol,{allowed:false,reason:'server-v2'});
  assert.deepEqual(f.calls,['account-marker','local-marker','server']);
});

test('fenced recovery failure and missing marker preserve the blocked decision and original error',async()=>{
  const failure=new Error('storage_owner_changed');
  for(const options of [{failure},{installMarker:false}]){
    const f=fixture(options),decision=await f.runtime.check({primary:true,online:true});
    assert.deepEqual(decision.protocol,{allowed:false,reason:'server-v2'});
    assert.equal(decision.accountV2Active,false);
    if(options.failure)assert.equal(decision.recoveryError,failure);
    else assert.equal(decision.recoveryError.message,'storage_fenced_recovery_marker_missing');
    assert.equal(f.calls.filter(value=>value==='adopt').length,1);
  }
});

test('marker read failures propagate without a server read or any recovery attempt',async()=>{
  const failure=new Error('idb_unavailable');let serverReads=0,recovery=0;
  const runtime=createStorageStartupProtocol({ownership:{current:()=> 'account',authenticated:()=> 'account'},
    markers:{account:async()=>{throw failure},local:async()=>assert.fail('account read must finish first')},
    account:{read:async()=>{serverReads++},recoverAccount:async()=>{recovery++}}});
  await assert.rejects(runtime.check({primary:true,online:true}),actual=>actual===failure);
  assert.equal(serverReads,0);assert.equal(recovery,0);
});

for(const [app,createCoordinator] of [['kupa',createKupaStorageV2Coordinator],['orders',createOrdersStorageV2Coordinator]]){
  test(`${app} storage startup rejects use before composition binding`,async()=>{
    const coordinator=createCoordinator({tab:{primaryTab:true},session:{},storage:null});
    await assert.rejects(coordinator.startupProtocol.check({primary:true,online:true}),new RegExp(`${app}_storage_v2_not_configured`));
    assert.throws(()=>coordinator.startupProtocol.verifyLocal(),new RegExp(`${app}_storage_v2_not_configured`));
  });
}

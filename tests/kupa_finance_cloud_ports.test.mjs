import test from 'node:test';
import assert from 'node:assert/strict';
import {createKupaFinanceCloudPorts} from '../netunim-kupa/site/assets/js/composition/finance-cloud.js';
import {composeKupaFinance} from '../netunim-kupa/site/assets/js/composition/finance.js';

test('finance capability can be assembled before the modal and binds its importer afterward',()=>{
  let modalReady=false;
  const unexpected=()=>assert.fail('composition performed I/O or used the modal during construction');
  const capability=composeKupaFinance({automaticAccess:unexpected,operationAccess:unexpected,
    model:{state:{creditSync:{}}},session:{},checksSession:{},ui:{currentPage:'cash'},
    cloudAuth:{supaRest:unexpected,supaEnsureSession:unexpected},
    cloudTransport:{},syncDocument:{},syncChecksState:{},syncChecks:{},
    storagePersistence:{},uiStatus:{},uiNavigation:{},uiDateEditor:{},
    financeDerivations:{run:unexpected},domainsBankSelectors:{},domainRevisions:{},
    getUiModal:()=>modalReady?{}:unexpected(),
  });
  assert.equal(typeof capability.creditController.refreshCreditSync,'function');
  assert.equal(typeof capability.bankController.refreshBankBalance,'function');
  assert.equal(typeof capability.bankView.renderBank,'function');
  modalReady=true;
  assert.equal(typeof capability.createConnectionImporter(),'function');
});

test('finance snapshot uses local state without cloud work and refuses an offline remote read',async()=>{
  const state={bank:{balance:10}},session={connectionMode:'local',dbRevision:3,financeRevision:4};
  let reads=0;
  const ports=createKupaFinanceCloudPorts({
    model:{state},session,isOnline:()=>false,
    cloudTransport:{readSupabaseDocument:async()=>{reads++}},
    syncDocument:{cloudPoll:async()=>{}},
  });
  assert.deepEqual(await ports.refreshFinanceCloudSnapshot(),{verified:true,state,revision:3,financeRevision:4});
  session.connectionMode='supabase';
  session.backendReady=true;
  assert.deepEqual(await ports.refreshFinanceCloudSnapshot(),{verified:false,state:null});
  assert.equal(reads,0);
});

test('finance snapshot polls when either cloud revision advances and fails closed on an unreadable head',async()=>{
  const session={connectionMode:'supabase',backendReady:true,dbRevision:3,financeRevision:4};
  const state={bank:{balance:20}};
  let polls=0,row={state,revision:3,financeRevision:5};
  const ports=createKupaFinanceCloudPorts({
    model:{state:{}},session,isOnline:()=>true,
    cloudTransport:{readSupabaseDocument:async()=>row},
    syncDocument:{cloudPoll:async()=>{polls++}},
    reportError:()=>assert.fail('unexpected cloud error'),
  });
  assert.deepEqual(await ports.refreshFinanceCloudSnapshot(),{verified:true,state,revision:3,financeRevision:5});
  assert.equal(polls,1);
  row={state,revision:3,financeRevision:4};
  await ports.refreshFinanceCloudSnapshot();
  assert.equal(polls,1);
  row={revision:8};
  assert.deepEqual(await ports.refreshFinanceCloudSnapshot(),{verified:false,state:null});
  assert.equal(polls,1);
});

test('finance snapshot treats a failed preflight as unverified',async()=>{
  const failure=new Error('network unavailable'),reported=[];
  const ports=createKupaFinanceCloudPorts({
    model:{state:{}},session:{connectionMode:'supabase',backendReady:true},isOnline:()=>true,
    cloudTransport:{readSupabaseDocument:async()=>{throw failure}},
    syncDocument:{cloudPoll:async()=>assert.fail('poll after failed read')},
    reportError:error=>reported.push(error),
  });
  assert.deepEqual(await ports.refreshFinanceCloudSnapshot(),{verified:false,state:null});
  assert.deepEqual(reported,[failure]);
});

test('finance patch tracks the returned revision and only releases leases acquired remotely',async()=>{
  const session={connectionMode:'supabase',backendReady:true,financeRevision:2};
  const claims=[],releases=[];
  let acquired=false;
  const ports=createKupaFinanceCloudPorts({
    model:{state:{}},session,
    cloudTransport:{
      saveFinancePatch:async(...args)=>({row:{revision:6,updated_at:'2026-10-07T00:00:00Z'},args}),
      claimFinanceSyncLease:async(...args)=>{claims.push(args);return {acquired}},
      releaseFinanceSyncLease:async(...args)=>{releases.push(args);return true},
    },
    syncDocument:{},
  });
  assert.deepEqual((await ports.saveFinancePatchTracked('patch')).args,['patch']);
  assert.equal(session.financeRevision,6);
  assert.equal(session.financeUpdatedAt,'2026-10-07T00:00:00Z');
  await ports.claimFinanceSyncLease('bank','lease-1');
  await ports.releaseFinanceSyncLease('bank','lease-1');
  assert.deepEqual(releases,[]);
  acquired=true;
  await ports.claimFinanceSyncLease('credit','lease-2');
  await ports.releaseFinanceSyncLease('credit','lease-2');
  await ports.releaseFinanceSyncLease('credit','lease-2');
  assert.deepEqual(claims,[['bank','lease-1'],['credit','lease-2']]);
  assert.deepEqual(releases,[['credit','lease-2']]);
  session.connectionMode='local';
  assert.deepEqual(await ports.claimFinanceSyncLease('bank','local'),{acquired:true,localOnly:true});
  await ports.releaseFinanceSyncLease('bank','local');
  assert.deepEqual(releases,[['credit','lease-2']]);
});

test('late finance receipt cannot update the new runtime revision',async()=>{
  const session={financeRevision:3,financeUpdatedAt:'old'};let valid=true;
  const assertCurrent=()=>{if(!valid)throw Object.assign(new Error('changed login'),{code:'FINANCE_OPERATION_SCOPE_CHANGED'})};
  const ports=createKupaFinanceCloudPorts({session,cloudTransport:{saveFinancePatch:async()=>{valid=false;return {saved:true,row:{revision:9,updated_at:'new'}}}}});
  await assert.rejects(ports.saveFinancePatchTracked(()=>({}),null,{assertCurrent}),{code:'FINANCE_OPERATION_SCOPE_CHANGED'});
  assert.deepEqual(session,{financeRevision:3,financeUpdatedAt:'old'});
});

test('finance composition forwards renewal TTL and authorization to lease transport',async()=>{
  const calls=[],session={connectionMode:'supabase',backendReady:true};let checks=0;
  const options={ttlSeconds:60,assertCurrent:()=>{checks++}};
  const ports=createKupaFinanceCloudPorts({session,cloudTransport:{
    claimFinanceSyncLease:async(...args)=>{calls.push(['claim',...args]);return {acquired:true}},
    releaseFinanceSyncLease:async(...args)=>{calls.push(['release',...args]);return true},
  }});
  await ports.claimFinanceSyncLease('credit','L',options);await ports.releaseFinanceSyncLease('credit','L',options);
  assert.deepEqual(calls,[['claim','credit','L',options],['release','credit','L',options]]);assert.equal(checks,2);
});

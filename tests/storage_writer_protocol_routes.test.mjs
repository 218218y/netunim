import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport as ordersTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createCloudTransport as kupaTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {INITIAL_STATE} from '../netunim-orders/site/assets/js/state/constants.js';
import {createRestoreGroup} from '../shared/restore-groups.js';
import {checkLegacyAccountStartup} from '../shared/storage-v2-server-protocol.js';

const response={ok:true,text:async()=>JSON.stringify([{revision:1,state:{}}])};
const ordersState=()=>{const state=structuredClone(INITIAL_STATE);delete state.checks;return state};

test('V2 transports use v6 while the retained legacy drain still uses v5',async()=>{
  const ordersPaths=[],kupaPaths=[];
  const orders=ordersTransport({supaFetch:async path=>{ordersPaths.push(path);return response}});
  const kupa=kupaTransport({supaRest:async path=>{kupaPaths.push(path);return response}});
  const state=ordersState();
  await orders.rpcSave(state,0,'legacy-main');
  await orders.rpcSaveV2(state,0,'v2-main');
  await orders.rpcSaveSharedChecks([],0,'legacy-shared');
  await orders.rpcSaveSharedChecksV2([],0,'v2-shared');
  const group=await createRestoreGroup({appSite:'orders',main:{documentName:'suppliers',baseRevision:1,state,operationId:'restore-main'},restoreGroupId:'55555555-5555-4555-8555-555555555555'});
  await orders.stageRestoreGroup(group);
  await orders.applyRestoreGroup('55555555-5555-4555-8555-555555555555');
  await kupa.rpcSaveSharedChecks([],0,'legacy-shared');
  await kupa.rpcSaveSharedChecksV2([],0,'v2-shared');
  await kupa.stageRestoreGroup(group);
  await kupa.applyRestoreGroup('55555555-5555-4555-8555-555555555555');
  assert.deepEqual(ordersPaths,[
    '/rest/v1/rpc/save_order_management_document_v5',
    '/rest/v1/rpc/save_order_management_document_v6',
    '/rest/v1/rpc/save_shared_checks_document_v5',
    '/rest/v1/rpc/save_shared_checks_document_v6',
    '/rest/v1/rpc/stage_restore_group_v6',
    '/rest/v1/rpc/apply_restore_group_v6',
  ]);
  assert.deepEqual(kupaPaths,[
    '/rest/v1/rpc/save_shared_checks_document_v5',
    '/rest/v1/rpc/save_shared_checks_document_v6',
    '/rest/v1/rpc/stage_restore_group_v6',
    '/rest/v1/rpc/apply_restore_group_v6',
  ]);
});

test('account protocol preflight permits local V2 and an existing account marker without network',async()=>{
  let calls=0;const readProtocolState=async()=>{calls++;throw Error('offline')};
  assert.equal((await checkLegacyAccountStartup({owner:'local',online:false,readProtocolState})).allowed,true);
  assert.equal((await checkLegacyAccountStartup({owner:'local',localEngineActive:true,online:false,authenticatedOwner:'account',readProtocolState})).allowed,true);
  assert.equal((await checkLegacyAccountStartup({owner:'account',cutoverActive:true,online:false,readProtocolState})).allowed,true);
  assert.equal(calls,0);
});

test('unmarked account requires authenticated online server proof before legacy recovery',async()=>{
  const base={owner:'account',cutoverActive:false,online:true,authenticatedOwner:'account'};
  const readProtocolState=async()=>({orders:1,kupa:1,sharedChecks:1});
  assert.deepEqual(await checkLegacyAccountStartup({...base,readProtocolState}),{allowed:true,reason:'legacy-account'});
  assert.deepEqual(await checkLegacyAccountStartup({...base,readProtocolState:async()=>({orders:2,kupa:2,sharedChecks:2})}),{allowed:false,reason:'server-v2'});
  assert.equal((await checkLegacyAccountStartup({...base,online:false,readProtocolState})).allowed,false);
  assert.equal((await checkLegacyAccountStartup({...base,authenticatedOwner:'other',readProtocolState})).allowed,false);
  assert.equal((await checkLegacyAccountStartup({...base,readProtocolState:async()=>{throw Error('network')}})).allowed,false);
  assert.equal((await checkLegacyAccountStartup({...base,readProtocolState:async()=>({orders:2,kupa:1,sharedChecks:2})})).allowed,false);
  assert.deepEqual(await checkLegacyAccountStartup({...base,owner:'local',readProtocolState:async()=>({orders:2,kupa:2,sharedChecks:2})}),{allowed:false,reason:'server-v2'});
});

test('both transports read the authenticated server protocol through the dedicated RPC',async()=>{
  const paths=[],reply={ok:true,json:async()=>({orders:2,kupa:2,sharedChecks:2})};
  const orders=ordersTransport({supaFetch:async path=>{paths.push(path);return reply}});
  const kupa=kupaTransport({supaRest:async path=>{paths.push(path);return reply}});
  assert.equal((await orders.readStorageProtocolState()).sharedChecks,2);
  assert.equal((await kupa.readStorageProtocolState()).orders,2);
  assert.deepEqual(paths,['/rest/v1/rpc/get_storage_protocol_state','/rest/v1/rpc/get_storage_protocol_state']);
});

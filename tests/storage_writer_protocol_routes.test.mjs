import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport as ordersTransport} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createCloudTransport as kupaTransport} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {INITIAL_STATE} from '../netunim-orders/site/assets/js/state/constants.js';

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
  await orders.applyRestoreGroup('55555555-5555-4555-8555-555555555555');
  await kupa.rpcSaveSharedChecks([],0,'legacy-shared');
  await kupa.rpcSaveSharedChecksV2([],0,'v2-shared');
  await kupa.applyRestoreGroup('55555555-5555-4555-8555-555555555555');
  assert.deepEqual(ordersPaths,[
    '/rest/v1/rpc/save_order_management_document_v5',
    '/rest/v1/rpc/save_order_management_document_v6',
    '/rest/v1/rpc/save_shared_checks_document_v5',
    '/rest/v1/rpc/save_shared_checks_document_v6',
    '/rest/v1/rpc/apply_restore_group_v6',
  ]);
  assert.deepEqual(kupaPaths,[
    '/rest/v1/rpc/save_shared_checks_document_v5',
    '/rest/v1/rpc/save_shared_checks_document_v6',
    '/rest/v1/rpc/apply_restore_group_v6',
  ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudTransport as orders} from '../netunim-orders/site/assets/js/cloud/transport.js';
import {createCloudTransport as kupa} from '../netunim-kupa/site/assets/js/cloud/transport.js';
import {createMainDocumentWrite} from '../netunim-kupa/site/assets/js/cloud/main-document-write.js';
import {readDocumentWriteAck,readDocumentWriteResponseRow} from '../shared/document-write-ack.js';

const sent={notes:[]},good={revision:1,state:sent};
const response=body=>({ok:true,text:async()=>JSON.stringify(body),json:async()=>body});
const orderState=Object.fromEntries(['suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes',
  'inventoryItems','inventoryCategoryOrder','inventoryEvents','warehouseOrders'].map(key=>[key,[]]));
const badBodies=[null,true,[],[null],[good,good]];
for(const [app,create] of [['orders',orders],['kupa',kupa]]){
  const api=body=>create({session:{cloudDocumentName:'main'},supaFetch:async()=>response(body),supaRest:async()=>response(body)});
  test(`${app} Shared write transport cannot discard a second receipt`,async()=>{
    for(const body of badBodies)await assert.rejects(api(body).rpcSaveSharedChecksV2([],0,'OP'),/document_write_ack_response_invalid/);
    assert.deepEqual((await api([good]).rpcSaveSharedChecksV2([],0,'OP')).row,good);
  });
  test(`${app} archive reconciliation validates success even with no source transactions`,async()=>{
    const receipt={inserted_count:0,updated_count:0,total_count:0,missing_count:0,active_missing_count:0,snapshot_stored:false,baseline_created:false};
    for(const body of [null,{},[],[receipt,receipt],[{...receipt,total_count:'0'}],[{...receipt,missing_count:1}],
      [{...receipt,snapshot_stored:true}],[{...receipt,baseline_created:true}],[{...receipt,active_missing_count:1}]]){
      await assert.rejects(api(body).syncBankTransactionsSnapshot('account','business',[],{snapshotAt:'2026-10-16T10:00:00Z'}),{code:'BANK_RESPONSE_EVIDENCE_INVALID'});
    }
    const result=await api([receipt]).syncBankTransactionsSnapshot('account','business',[],{snapshotAt:'2026-10-16T10:00:00Z'});
    assert.deepEqual(result.result,receipt);assert.equal(result.complete,false);
  });
}
test('Orders Main and Kupa settings writes reject ambiguous successful envelopes',async()=>{
  for(const body of badBodies){
    const api=orders({supaFetch:async()=>response(body)});
    await assert.rejects(api.rpcSaveV2(orderState,0,'OP'),/document_write_ack_response_invalid/);
    await assert.rejects(api.rpcSaveKupaDocument({credits:[],cash:[],rights:[],notes:[],expenses:[],cards:[]},0,'OP'),/document_write_ack_response_invalid/);
  }
});
test('Kupa Main writer checks envelope before exposing its row',async()=>{
  for(const body of badBodies){
    const api=createMainDocumentWrite({documentName:()=> 'main',request:async()=>response(body),validate:x=>x,beginMeasure:()=>()=>{}});
    await assert.rejects(api.rpcSaveCloudV2(sent,0,'OP'),/document_write_ack_response_invalid/);
  }
  assert.equal(readDocumentWriteResponseRow([good]),good);
});
test('ACK revision evidence rejects coercible values while retaining numeric SQL strings',()=>{
  for(const revision of [null,false,true,[],[1],'',' 1 ','1e0']){
    assert.throws(()=>readDocumentWriteAck({revision,state:sent},{baseRevision:0,sentState:sent,prepareState:structuredClone}),/document_write_ack_revision_invalid/);
  }
  for(const operation_replayed of ['true',1,[]])assert.throws(()=>readDocumentWriteAck({...good,operation_replayed},
    {baseRevision:0,sentState:sent,prepareState:structuredClone}),/document_write_ack_revision_invalid/);
  assert.equal(readDocumentWriteAck({revision:'1',state:sent},{baseRevision:0,sentState:sent,prepareState:structuredClone}).revision,1);
});

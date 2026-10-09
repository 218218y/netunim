import test from 'node:test';
import assert from 'node:assert/strict';
import {documentWriteAckRevision,readDocumentWriteAck} from '../shared/document-write-ack.js';
import {equalSyncJson} from '../shared/sync-json.js';
import {documentWriteAckRevision as compatibleRevision,equalSyncJson as compatibleEqual} from '../shared/cloud-sync.js';

const sentState={notes:[{id:'N',content:'sent'}]};
const options={baseRevision:10,sentState,prepareState:structuredClone};
const row={revision:11,operation_revision:11,operation_replayed:false,state:sentState};

for(const [label,value] of [
  ['absent row',undefined],['null row',null],['array row',[]],
  ['missing state',{revision:11}],['undefined state',{...row,state:undefined}],
  ['null state',{...row,state:null}],['array state',{...row,state:[]}],
  ['string state',{...row,state:'sent'}],['boolean state',{...row,state:false}],
  ['numeric state',{...row,state:1}],['inherited state',Object.create(row)],
])test(`Main ACK rejects ${label} before domain preparation`,()=>{
  let prepared=0;
  assert.throws(()=>readDocumentWriteAck(value,{...options,prepareState:()=>{prepared++;return sentState},stateErrorCode:'main_ack_state_invalid'}),/main_ack_state_invalid/);
  assert.equal(prepared,0,'normalization must not synthesize a document for absent data');
});

test('the domain owns business validation and its error is propagated unchanged',()=>{
  const failure=new Error('invalid_business_ids');
  assert.throws(()=>readDocumentWriteAck(row,{...options,prepareState:()=>{throw failure}}),error=>error===failure);
});

test('an unchecked projection cannot return a missing or detached document',()=>{
  for(const state of [undefined,null,[],false])assert.throws(()=>readDocumentWriteAck(row,{...options,prepareState:()=>state}),/document_write_ack_state_invalid/);
});

test('replay receipts retain the later authoritative head rather than substituting the sent snapshot',()=>{
  const remote={notes:[...sentState.notes,{id:'R',content:'other-computer'}]};
  const receipt=readDocumentWriteAck({...row,revision:12,state:remote,operation_replayed:true},options);
  assert.deepEqual(receipt,{revision:12,operationRevision:11,replayed:true,state:remote});
  assert.notEqual(receipt.state,remote);assert.deepEqual(sentState,{notes:[{id:'N',content:'sent'}]});
});

test('V6 and legacy-compatible no-op receipts retain the revision and numeric wire compatibility',()=>{
  assert.equal(readDocumentWriteAck({...row,revision:10,operation_revision:10},options).revision,10);
  assert.equal(readDocumentWriteAck({revision:'10',state:sentState},options).operationRevision,null);
  assert.deepEqual(readDocumentWriteAck({...row,revision:'12',operation_revision:'11',operation_replayed:true},options),
    {revision:12,operationRevision:11,replayed:true,state:sentState});
});

for(const [label,overrides] of [
  ['stale head',{revision:9}],['fractional head',{revision:11.5}],
  ['unsafe head',{revision:Number.MAX_SAFE_INTEGER+1}],['invalid head',{revision:'invalid'}],
  ['stale operation',{operation_revision:9}],['operation past head',{operation_revision:12}],
  ['operation past one write',{revision:13,operation_revision:12,operation_replayed:true}],
  ['non-replay with a later head',{revision:12,operation_replayed:false}],
  ['fractional operation',{operation_revision:10.5}],['invalid operation',{operation_revision:'invalid'}],
])test(`Main ACK rejects ${label}`,()=>{
  assert.throws(()=>readDocumentWriteAck({...row,...overrides},{...options,errorCode:'main_ack_revision_invalid'}),/main_ack_revision_invalid/);
});

test('legacy no-op requires the returned state to equal the sent state',()=>{
  assert.throws(()=>readDocumentWriteAck({revision:10,state:{notes:[]} },options),/document_write_ack_revision_invalid/);
});

test('a legacy no-op accepts JSONB key ordering through the domain equality port',()=>{
  const sent={settings:{a:1,b:2}},remote={settings:{b:2,a:1}};
  assert.equal(readDocumentWriteAck({revision:10,state:remote},{...options,sentState:sent}).revision,10);
  assert.throws(()=>readDocumentWriteAck({revision:10,state:remote},{...options,sentState:sent,equalState:()=>false}),/document_write_ack_revision_invalid/);
});

test('compatibility exports are the actual checked implementations',()=>{
  assert.equal(compatibleRevision,documentWriteAckRevision);assert.equal(compatibleEqual,equalSyncJson);
  assert.throws(()=>compatibleRevision(),/document_write_ack_revision_invalid/);
});

test('canonical JSON comparison preserves existing serialization semantics',()=>{
  assert.equal(equalSyncJson(undefined,null),true);
  assert.equal(equalSyncJson({b:{y:2,x:1},a:3},{a:3,b:{x:1,y:2}}),true);
  assert.equal(equalSyncJson({missing:undefined,kept:null},{kept:null}),true);
  assert.equal(equalSyncJson([undefined],[null]),true);
  assert.equal(equalSyncJson([1,2],[2,1]),false);
  const date=new Date('2026-10-09T00:00:00Z');assert.equal(equalSyncJson({date},{date:date.toJSON()}),true);
  assert.throws(()=>equalSyncJson({cycle:1n},{}),TypeError);
});

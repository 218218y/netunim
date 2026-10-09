import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStorageJson,storageChecksum,sealStorageJsonRecord,readStorageJsonRecord} from '../shared/storage-json-codec.js';
import {assertStorageJson as compatibleAssert,storageChecksum as compatibleChecksum,sealStorageRecord,readStorageRecord} from '../shared/storage-journal-model.js';
import {storageRecoveryFailure} from '../shared/storage-v2-runtime.js';

for(const [label,value] of [
  ['undefined',undefined],['callback',()=>{}],['non-finite number',Infinity],['NaN',NaN],
  ['BigInt',1n],['Date',new Date()],['Map',new Map()],['Set',new Set()],
  ['null prototype',Object.create(null)],['undefined field',{missing:undefined}],
])test(`JSON codec rejects ${label} under the existing rules`,()=>{
  assert.throws(()=>assertStorageJson(value),/^Error: storage_non_json_value$/);
  assert.throws(()=>sealStorageJsonRecord(value),/^Error: storage_non_json_value$/);
});

test('cycles fail while repeated non-cyclic references retain existing JSON semantics',()=>{
  const cycle={};cycle.self=cycle;assert.throws(()=>assertStorageJson(cycle),/storage_non_json_value/);
  const shared={id:'N'},value={first:shared,second:shared};
  assert.equal(assertStorageJson(value),value);
  assert.deepEqual(readStorageJsonRecord(sealStorageJsonRecord(value)),value);
});

test('unsafe JSON keys remain rejected even when an envelope checksum matches',()=>{
  for(const key of ['__proto__','prototype','constructor']){
    const value=JSON.parse(`{"${key}":"unsafe"}`);
    assert.throws(()=>readStorageJsonRecord({data:value,checksum:storageChecksum(JSON.stringify(value))}),/^Error: storage_unsafe_key$/);
  }
});

test('sealing and reading detach data; mutation invalidates the checksum rather than altering the source',()=>{
  const value={notes:[{id:'N',text:'retained'}]},sealed=sealStorageJsonRecord(value);
  const decoded=readStorageJsonRecord(sealed);decoded.notes[0].text='changed';
  assert.equal(sealed.data.notes[0].text,'retained');assert.equal(value.notes[0].text,'retained');
  sealed.data.notes[0].text='corrupt';assert.throws(()=>readStorageJsonRecord(sealed),/^Error: storage_checksum_mismatch$/);
});

test('checksum remains byte-order sensitive and matches the baseline empty-text vector',()=>{
  assert.equal(storageChecksum(''),'811c9dc59e3779b9');
  assert.notEqual(storageChecksum('{"a":1,"b":2}'),storageChecksum('{"b":2,"a":1}'));
});

test('compatibility exports retain checked implementations and sealed byte representation',()=>{
  assert.equal(compatibleAssert,assertStorageJson);assert.equal(compatibleChecksum,storageChecksum);assert.equal(readStorageRecord,readStorageJsonRecord);
  const value={owner:'account',state:{notes:[{id:'N'}]}};
  assert.equal(JSON.stringify(sealStorageRecord(value,{kind:'checkpoint'})),JSON.stringify(sealStorageJsonRecord(value)));
});

test('measurement ports keep validate/clone/stringify/bytes order and original errors',()=>{
  const stages=[],value={notes:[]};
  sealStorageJsonRecord(value,{kind:'checkpoint',measure:(name,work)=>{stages.push(name);return work()},onSerialized:text=>{stages.push('bytes');assert.equal(text,JSON.stringify(value))}});
  assert.deepEqual(stages,['validate','checkpoint-clone','checkpoint-stringify','bytes']);
  const failure=new Error('instrumentation_failed');
  assert.throws(()=>sealStorageJsonRecord(value,{onSerialized:()=>{throw failure}}),error=>error===failure);
});

test('unknown malformed envelopes fail checksum verification before kind decoding',()=>{
  for(const record of [undefined,null,[],{},{data:{},checksum:'invalid'}, {data:{},checksum:1}])
    assert.throws(()=>readStorageJsonRecord(record),/^Error: storage_checksum_mismatch$/);
});

test('non-JSON persisted values produce the explicit corruption error before serialization can throw',()=>{
  const cycle={};cycle.self=cycle;
  for(const data of [{counter:1n},cycle,{callback:()=>{}},{missing:undefined},()=>{}])
    assert.throws(()=>readStorageJsonRecord({data,checksum:'untrusted'}),error=>{
      assert.equal(error.message,'storage_non_json_value');assert.equal(storageRecoveryFailure(error),'fatal');return true;
    });
});

test('historical falsy-root envelope rejection remains unchanged',()=>{
  for(const data of [null,false,0,''])assert.throws(()=>readStorageJsonRecord(sealStorageJsonRecord(data)),/^Error: storage_checksum_mismatch$/);
});

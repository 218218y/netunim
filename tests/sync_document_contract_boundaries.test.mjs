import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStorageJsonObject} from '../shared/storage-json-codec.js';
import {responseProperty} from '../shared/response-evidence.js';
test('durable conflict admission validates the whole JSON object without replacing evidence',()=>{
  const value={kind:'entity-conflict',items:[{local:{amount:0},remote:null}]};
  assert.equal(assertStorageJsonObject(value),value);
  for(const invalid of [null,[],false,'ack',{items:[{local:undefined}]},{amount:NaN},{callback:()=>true}])assert.throws(()=>assertStorageJsonObject(invalid));
});
test('response field reads inspect unknown errors without conferring receipt authority',()=>{
  const raw={message:'offline',revision:'unverified'};
  assert.equal(responseProperty(raw,'message'),'offline');assert.equal(responseProperty(raw,'revision'),'unverified');
  for(const invalid of [null,undefined,[],false,4,'ack'])assert.equal(responseProperty(invalid,'revision'),undefined);
});

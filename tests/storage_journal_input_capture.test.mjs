import test from 'node:test';
import assert from 'node:assert/strict';
import {sealStorageJsonRecord as seal} from '../shared/storage-json-codec.js';
import {captureStorageCloudBase,captureStorageCloudFlight,captureStorageCloudControl,
  captureStorageExpectedHead,captureStorageRecoveryHead,captureStorageLocalHead,captureStorageCleanHead,
  captureStorageJournalPayload} from '../shared/storage-journal-authority.js';

const base={version:2,owner:'A:orders',epoch:'E',revision:1,ackSeq:0,state:{notes:[{id:'N',text:'accepted'}]}};
for(const [name,capture,data] of [
  ['base',captureStorageCloudBase,base],
  ['flight',captureStorageCloudFlight,{version:2,owner:'A:orders',epoch:'E',operationId:'OP',baseRevision:1,startSeq:1,endSeq:1,snapshot:base.state}],
  ['control',captureStorageCloudControl,{version:2,owner:'A:orders',epoch:'E',retry:{attempts:1}}],
])test(`${name} capture validates and detaches the full sealed input`,()=>{
  const input=seal(data),accepted=capture(input),original=structuredClone(accepted);
  input.data.epoch='changed';input.data.extra={mutable:true};
  Object.assign(input,seal(input.data));
  assert.deepEqual(accepted,original);assert.equal(accepted.data.epoch,'E');
  assert.throws(()=>capture(seal({...data,version:'2'})));
});

const head={seq:0,checkpointChecksum:'CP',baseChecksum:'BASE',controlChecksum:null};
for(const [name,capture,input] of [
  ['cloud',captureStorageExpectedHead,head],
  ['recovery',captureStorageRecoveryHead,{...head,owner:'A:orders',epoch:'E',baseRevision:1,ackSeq:0}],
  ['local',captureStorageLocalHead,{seq:0,checkpointChecksum:'CP',epoch:'E'}],
  ['clean',captureStorageCleanHead,{seq:0,checkpointChecksum:'CP',epoch:'E',revision:1}],
])test(`${name} preconditions are captured before IDB scheduling`,()=>{
  const value=structuredClone(input),accepted=capture(value);value.seq=99;value.checkpointChecksum='changed';
  assert.equal(accepted.seq,0);assert.equal(accepted.checkpointChecksum,'CP');
  for(const patch of [{seq:'0'},{seq:-1},{checkpointChecksum:[]},{checkpointChecksum:''}])assert.throws(()=>capture({...input,...patch}));
});

test('recovery preconditions require all revision and owner evidence',()=>{
  const input={...head,owner:'A:orders',epoch:'E',baseRevision:1,ackSeq:0};
  for(const patch of [{owner:[]},{epoch:null},{baseRevision:true},{ackSeq:1},{controlChecksum:[]}])assert.throws(()=>captureStorageRecoveryHead({...input,...patch}));
});

test('transition payload capture detaches nested data and rejects non-JSON commands',()=>{
  const input={id:'boundary',main:{state:{notes:[{id:'N'}]}}},accepted=captureStorageJournalPayload(input);
  input.main.state.notes[0].id='changed';assert.equal(accepted.main.state.notes[0].id,'N');
  for(const value of [null,[],{callback:()=>{}},{number:Infinity}])assert.throws(()=>captureStorageJournalPayload(value));
});

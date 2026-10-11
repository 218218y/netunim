import test from 'node:test';
import assert from 'node:assert/strict';
import {readCloudWriteScope,captureCloudWriteScope,cloudWriteScopeIsCurrent,cloudWriteScopeHasIdentity} from '../shared/cloud-write-scope.js';

const storage={owner:'synthetic:orders',epoch:'journal-A',accountOwner:'synthetic',writable:true},account={owner:'synthetic',epoch:7};
const live=readCloudWriteScope(storage,account),head={base:storage};
test('publication needs both the live writable identity and the committed identity',()=>{
  const scope=captureCloudWriteScope(live,head);
  assert.ok(Object.isFrozen(scope));assert.ok(cloudWriteScopeIsCurrent(scope,live,head));
  for(const changed of [{owner:'other:orders'},{epoch:'journal-B'},{accountOwner:'other'},{loginEpoch:8},{writable:false}]){
    assert.equal(cloudWriteScopeIsCurrent(scope,{...live,...changed},head),false);
  }
  assert.equal(cloudWriteScopeIsCurrent(scope,live,{base:{...storage,epoch:'journal-B'}}),false);
  assert.equal(cloudWriteScopeIsCurrent(scope,live,{base:null}),false);
  assert.equal(cloudWriteScopeIsCurrent(scope,null,head),false);
  assert.equal(cloudWriteScopeIsCurrent(null,live,head),false);
});
test('a resource may finish after leadership loss, but cannot clean another identity',()=>{
  assert.ok(cloudWriteScopeHasIdentity(live,{...live,writable:false}));
  assert.equal(cloudWriteScopeHasIdentity(live,{...live,loginEpoch:8}),false);
});
test('missing or invalid authority cannot be captured from a cached head',()=>{
  assert.equal(readCloudWriteScope(null,account),null);
  for(const epoch of [-1,NaN,Infinity,1.5])assert.equal(readCloudWriteScope(storage,{...account,epoch}),null);
  assert.equal(readCloudWriteScope(storage,{owner:null,epoch:7}),null);
  assert.equal(readCloudWriteScope(storage,{owner:'another-account',epoch:7}),null);
  assert.equal(captureCloudWriteScope({...live,writable:false},head),null);
  assert.equal(captureCloudWriteScope(live,{base:{...storage,owner:'other'}}),null);
});

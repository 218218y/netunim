import test from 'node:test';
import assert from 'node:assert/strict';
import {applyStorageV2RestoreGroup,captureStorageV2RestoreSource} from '../shared/storage-v2-restore.js';

const clean=(seq,revision)=>({seq,base:{revision},pending:false,flight:null,control:null});

test('cloud restore carries both original sequences into one durable V2 boundary',async()=>{
  const v2Source=captureStorageV2RestoreSource(clean(4,8),clean(7,11));let intent=null;
  const group={restoreGroupId:'restore-123',v2Source,main:{baseRevision:8,state:{orders:[]}},checks:{baseRevision:11}};
  const target={orders:[{id:'O'}],checks:[{id:'C'}]},sharedState={checks:[{id:'C'}],bankEvents:[]};
  const result=await applyStorageV2RestoreGroup({boundary:{run:async value=>{intent=value}},group,result:{main_revision:9,checks_revision:12},target,sharedState});
  assert.deepEqual(result,{mainRevision:9,sharedRevision:12});
  assert.equal(intent.id,'restore-123');assert.equal(intent.kind,'restore');
  assert.equal(intent.main.expectedSeq,4);assert.equal(intent.shared.expectedSeq,7);
  assert.equal(intent.main.expectedBaseRevision,8);assert.equal(intent.shared.expectedBaseRevision,11);
  assert.equal(intent.main.options.appMetadata.revision,9);
  assert.equal(intent.main.requireCleanCloud,true);assert.equal(intent.shared.requireCleanCloud,true);
  assert.deepEqual(intent.main.cloudState,{orders:[]});assert.deepEqual(intent.shared.state,sharedState);
});

test('restore source capture refuses an unresolved flight or missing cursor',()=>{
  assert.throws(()=>captureStorageV2RestoreSource({...clean(1,2),flight:{operationId:'F'}},clean(0,1)),/head_not_clean/);
  assert.throws(()=>captureStorageV2RestoreSource(clean(1,2),{seq:0,base:null}),/head_not_clean/);
});

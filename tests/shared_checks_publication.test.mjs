import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedChecksV2Runtime} from '../shared/shared-checks-v2-runtime.js';
import {createSharedChecksStorageV2} from '../shared/shared-checks-storage-v2.js';
import {memoryDb,emergencyStore} from './storage-v2-fixture.mjs';

const state=amount=>({checks:[{id:'C',amount}],bankEvents:[]});
const put={type:'put',collection:'checks',id:'C',mode:'replace'};
for(const action of ['adoption','ack','replacement'])for(const failure of ['apply','recover'])test(`Shared ${action} publication ${failure} failure closes admission until durable recovery`,async()=>{
  const db=memoryDb(),local=action==='replacement';let visible=state(100),fail=false,store;
  const runtime=createSharedChecksV2Runtime({owner:()=>local?'local':'A',primary:()=>true,mode:()=> 'primary',readState:()=>visible,
    applyState:value=>{if(fail&&failure==='apply')throw new Error('publish failed');visible=value},
    merge:(_base,local)=>({checks:local,conflicts:[]}),readRemote:async()=>({revision:8,state:state(200)}),
    rpc:async()=>({r:{ok:true},row:{revision:8,state:state(200)}}),
    createStorage:options=>{store=createSharedChecksStorageV2({...options,db,emergency:emergencyStore()});const recover=store.recover;
      store.recover=async()=>{if(fail&&failure==='recover'&&(await db.load()).checkpoints.data.state.checks[0].amount===200)throw new Error('publish failed');return recover()};return store}});
  if(local)await runtime.initializeLocal({state:visible});else await runtime.initialize({state:visible,revision:7,intent:'cloud-authoritative',sourceOwner:'A'});
  if(action==='ack'){visible=state(200);await runtime.persist([put]).committed}
  fail=true;
  await assert.rejects(local?runtime.replaceLocalAuthoritativeState(state(200),{boundaryId:'restore',expectedSeq:0}):runtime.sync(),/publish failed/);
  assert.equal(runtime.primaryReady,false);assert.equal(runtime.cloudReady,false);assert.equal(runtime.hasLocalWork,true);
  assert.throws(()=>runtime.persist([put]),/not_recovered/);await assert.rejects(runtime.flush(),/not_recovered/);
  await assert.rejects(async()=>runtime.sync(),/not_recovered/);
  const before=await db.load();fail=false;const recovered=await runtime.recover();
  assert.equal(recovered.epoch,before.metadata.epoch);assert.deepEqual(recovered.state,state(200));assert.equal(runtime.primaryReady,true);assert.equal(runtime.cloudReady,!local);
  visible=state(201);await runtime.persist([put]).committed;assert.equal(await runtime.flush(),true);
});

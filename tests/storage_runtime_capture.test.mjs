import test from 'node:test';
import assert from 'node:assert/strict';
import {createStorageV2Runtime} from '../shared/storage-v2-runtime.js';

function deferred(){let resolve;const promise=new Promise(yes=>{resolve=yes});return {promise,resolve}}
const clone=value=>structuredClone(value);
const cases={
  replaceCurrentState:(state,options)=>[state,options],
  replaceLocalAuthoritativeState:(state,options)=>[state,options],
  replaceAuthoritativeState:(state,options)=>[state,options],
  replaceLocalWithPending:(state,options)=>[state,options],
  resetCloudHead:(state,options)=>[3,state,state,options],
  setCloudBase:(state,options)=>[3,state,options],
  materializeFlight:(_state,options)=>[options],
  acknowledgeFlight:(state,options)=>['F',3,state,options],
  rejectFlight:(state,options)=>['F',3,state,options],
  setCloudControl:(state,options)=>[state,options],
  commitCloudRecovery:(state,options)=>[state,options],
};

async function fixture(app){
  const blocked=deferred(),calls=[];let owner='local';
  const journal={ready:true,epoch:'E',
    open:async()=>({state:{notes:[]},seq:0,appMetadata:{storageRole:'primary'}}),
    append:()=>({seq:1,emergencyDurable:true,committed:blocked.promise}),
  };
  for(const method of Object.keys(cases)){
    const port=({acknowledgeFlight:'acknowledge',rejectFlight:'rejectAndRebase'})[method]||method;
    journal[port]=async(...args)=>{calls.push({method,args});return {seq:1}};
  }
  const runtime=createStorageV2Runtime({app,owner:()=>owner,primary:()=>true,
    mode:()=> 'primary',validate:()=>{},createJournal:()=>journal});
  await runtime.recover();
  runtime.persist({notes:[]},{operations:[{type:'set',field:'settings',value:{}}]});
  return {runtime,calls,release:blocked.resolve,setOwner:value=>{owner=value}};
}

for(const app of ['orders','kupa'])for(const [method,argsFor] of Object.entries(cases)){
  test(`${app} ${method} captures command data before the runtime commit wait`,async()=>{
    const {runtime,calls,release}=await fixture(app);
    const state={notes:[{id:'N',content:'accepted'}]},options={
      appMetadata:{context:'accepted'},expectedSeq:1,ackSeq:1,
      boundaryId:'import-1',expectedBaseRevision:3,operationId:'F',baseRevision:3,
      throughSeq:1,snapshot:clone(state),currentState:clone(state),
      expectedLocalHead:{seq:1,epoch:'E',checkpointChecksum:'accepted'},
      expectedCleanHead:{seq:1,epoch:'E',revision:3,checkpointChecksum:'accepted'},
      expectedHead:{seq:1,baseRevision:3,checkpointChecksum:'accepted'},
      expectedScope:{owner:`local:${app}`,epoch:'E'},
      control:{conflict:{domain:app,reason:'accepted'}},
    };
    const accepted=argsFor(state,options);
    const expected=clone(accepted);
    const pending=runtime[method](...accepted);
    assert.equal(calls.length,0,'command must wait for the older durable commit');
    state.notes[0].content='caller changed';
    options.appMetadata.context='caller changed';options.expectedSeq=2;options.ackSeq=2;
    options.snapshot.notes[0].content='caller changed';
    options.expectedLocalHead.seq=2;options.expectedCleanHead.seq=2;options.expectedHead.seq=2;
    options.control.conflict.reason='caller changed';
    release();await pending;
    assert.equal(calls.length,1);
    const actual=calls[0].args;
    assert.ok(!JSON.stringify(actual).includes('caller changed'),JSON.stringify(actual));
    const capturedOptions=actual.at(-1);
    if(['replaceCurrentState','replaceAuthoritativeState','resetCloudHead','setCloudBase',
      'materializeFlight','acknowledgeFlight','rejectFlight'].includes(method)){
      assert.equal(capturedOptions.appMetadata.context,expected.at(-1).appMetadata.context);
    }
    if(method==='setCloudBase')assert.equal(capturedOptions.ackSeq,1);
    if(method==='replaceAuthoritativeState')assert.equal(capturedOptions.expectedLocalHead.seq,1);
    if(method==='resetCloudHead')assert.equal(capturedOptions.expectedCleanHead.seq,1);
    if(['acknowledgeFlight','rejectFlight'].includes(method))assert.equal(capturedOptions.expectedSeq,1);
    if(method==='commitCloudRecovery')assert.equal(capturedOptions.expectedHead.seq,1);
  });
}

test('owner change while a captured replacement waits cannot invoke the old journal',async()=>{
  const {runtime,calls,release,setOwner}=await fixture('orders');
  const pending=runtime.replaceCurrentState({notes:[]},{expectedSeq:1});
  setOwner('B');release();
  await assert.rejects(pending,/storage_owner_changed_during_operation/);
  assert.deepEqual(calls,[]);
});

for(const method of ['setCloudBase','captureCloudCursor','materializeFlight']){
  test(`${method} rechecks the coordinated boundary after waiting`,async()=>{
    const {runtime,calls,release}=await fixture('orders');
    let locked=false;runtime.setBoundaryGate(()=>locked);
    const pending=method==='setCloudBase'?runtime[method](3,{notes:[]})
      :method==='captureCloudCursor'?runtime[method](3):runtime[method]({operationId:'F'});
    locked=true;release();
    await assert.rejects(pending,/storage_boundary_in_progress/);
    assert.deepEqual(calls,[]);
  });
}

test('captured options retain policy callbacks, detach data, and preserve their inferred contract',async()=>{
  const {captureStorageCommandOptions}=await import('../shared/storage-journal-authority.js');
  const validate=()=>true,options={validate,head:{seq:1},optional:undefined};
  const captured=captureStorageCommandOptions(options);
  options.head.seq=2;
  assert.equal(captured.validate,validate);
  assert.equal(captured.head.seq,1);
  assert.ok(Object.hasOwn(captured,'optional'));
});

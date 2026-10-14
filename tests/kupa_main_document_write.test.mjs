import test from 'node:test';
import assert from 'node:assert/strict';
import {createMainDocumentWrite} from '../netunim-kupa/site/assets/js/cloud/main-document-write.js';
import {beginMeasure} from '../netunim-kupa/site/assets/js/shared/runtime-performance.js';
import {assertValidCloudState} from '../netunim-kupa/site/assets/js/state/validation.js';
import {INITIAL_STATE} from '../netunim-kupa/site/assets/js/state/constants.js';
import {createStateNormalization} from '../netunim-kupa/site/assets/js/composition/state-normalization.js';

const model={state:structuredClone(INITIAL_STATE)},normalization=createStateNormalization({model});
const snapshot=normalization.prepareKupaCloudState(normalization.normalizeState(model.state));
for(const bulk of [false,true])test(`Kupa Main writer preserves the ${bulk?'bulk delete':'ordinary'} wire envelope and captured operation`,async()=>{
  let name='main-A';const requests=[],audit={mutationType:bulk?'bulk-delete':'edit',surface:'notes'},intents={notes:['N']};
  const response={ok:true,text:async()=> '[{"revision":8,"operation_revision":7,"operation_replayed":true}]'};
  const writer=createMainDocumentWrite({validate:assertValidCloudState,beginMeasure,documentName:()=>name,request:async(path,options)=>{requests.push({path,options});return response}});
  name='main-B';const result=await writer.rpcSaveCloudV2(snapshot,6,' operation-retained ',intents,audit);
  assert.equal(requests[0].path,'/rest/v1/rpc/'+(bulk?'bulk_delete_save_kupa_document_v6':'save_kupa_document_v6'));
  assert.deepEqual(requests[0].options,{method:'POST',networkRetry:true,dataPriority:'high',body:JSON.stringify({p_document_name:'main-B',p_expected_revision:6,p_state:snapshot,p_operation_id:'operation-retained',p_delete_intents:intents,p_audit:audit})});
  assert.equal(result.r,response);assert.deepEqual(result.row,{revision:8,operation_revision:7,operation_replayed:true});
});
for(const body of ['', '{malformed', '{}', '[{}]', 'true', 'null'])test(`Kupa Main writer returns unknown ${JSON.stringify(body)} evidence without inventing an ACK`,async()=>{
  const response={ok:false,status:409,text:async()=>body},writer=createMainDocumentWrite({validate:assertValidCloudState,beginMeasure,documentName:()=> 'main',request:async()=>response});
  const result=await writer.rpcSaveCloudV2(snapshot,6,'operation');
  assert.equal(result.r,response);assert.equal(result.body,body);
  assert.deepEqual(result.row,body===''||body==='{malformed'||body==='null'?null:body==='true'?true:{});
});
for(const [revision,operation] of [[-1,'valid'],[1.5,'valid'],[1,' ']])test(`Kupa Main writer rejects invalid command ${revision}/${JSON.stringify(operation)} before network I/O`,async()=>{
  let requests=0;const writer=createMainDocumentWrite({validate:assertValidCloudState,beginMeasure,documentName:()=> 'main',request:async()=>{requests++;throw Error('unexpected request')}});
  await assert.rejects(writer.rpcSaveCloudV2(snapshot,revision,operation));assert.equal(requests,0);
});

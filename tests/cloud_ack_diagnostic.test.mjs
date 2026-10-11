import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudAckPublicationDiagnostic} from '../shared/cloud-ack-diagnostic.js';
import {normalizeCloudError} from '../shared/cloud-sync.js';
test('publication diagnostics expose only allowed phase/cursor scalars',()=>{
  const input={baseRevision:5,ackRevision:7,endSeq:8,candidateSeq:9,observedSeq:9,owner:'private-account',operationId:'private-operation',snapshot:{notes:'private'},error:'private-message'};
  const record=cloudAckPublicationDiagnostic('SCOPE_CHANGED_AFTER_COMMIT',input);
  assert.deepEqual(record,{phase:'SCOPE_CHANGED_AFTER_COMMIT',errorCode:'cloud_sync_scope_changed',baseRevision:5,ackRevision:7,endSeq:8,candidateSeq:9,observedSeq:9});
  assert.equal(JSON.stringify(record).includes('private'),false);
  for(const value of ['account',NaN,Infinity,-1,1.5,null])assert.deepEqual(cloudAckPublicationDiagnostic('ACK_PUBLICATION_EXCEPTION',{baseRevision:value}),{phase:'ACK_PUBLICATION_EXCEPTION',errorCode:'cloud_ack_publication_exception'});
});
test('structured ACK input/stale codes retain the existing error category',()=>{
  for(const code of ['storage_ack_checkpoint_required','storage_ack_checkpoint_stale']){
    const error=Object.assign(new Error(code),{code,candidateSeq:1,observedSeq:2});
    const normalized=normalizeCloudError(error);
    assert.equal(normalized.code,code);assert.equal(normalized.kind,'fatal');assert.equal(normalized.original,error);
  }
});

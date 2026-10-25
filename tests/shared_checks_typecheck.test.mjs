import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('Shared Checks implementation and negative storage/runtime consumers pass',()=>{
  const diagnostics=check();assert.equal(diagnostics.length,0,describe(diagnostics));
});
for(const [file,label,from,to] of [
  ['shared-checks-v2-runtime.js','commit receipt','commits=write.committed;return {handled:true,...write};','commits=write.committed;return {handled:true,...write,committed:true};'],
  ['shared-checks-v2-runtime.js','epoch identity','epoch=store.epoch,cloud=await store.cloudState()','epoch=200,cloud=await store.cloudState()'],
  ['shared-checks-v2-runtime.js','missing recovery','if(!recovered)throw new Error(\'shared_checks_not_recovered\');',''],
  ['shared-checks-v2-runtime.js','unvalidated remote state','const remote=canonical(row.state);','const remote=row.state;'],
  ['shared-checks-v2-runtime.js','boundary identity','store.replaceAuthoritativeState(canonical(state),{boundaryId})','store.replaceAuthoritativeState(canonical(state),{boundaryId:200})'],
  ['shared-checks-storage-v2.js','local receipt versus ACK','return journal.append(changes,{generation,surface,mutationType,deleteIntents:{checks:[...explicitDeletes]}});','return {seq:1,operationId:"F",emergencyDurable:true,transitionFallbackDurable:false,transitioning:false,committed:Promise.resolve({operationId:"F",revision:3,ackSeq:1})};'],
  ['shared-checks-storage-v2.js','bank event evidence','checkpointState:current,expectedSeq,control','checkpointState:{checks:current.checks,bankEvents:undefined},expectedSeq,control'],
])test('actual Shared Checks implementation rejects a mutation of '+label,()=>{
  const source=path.join(root,'shared',file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source),describe(diagnostics));
});

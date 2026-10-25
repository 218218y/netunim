import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('runtime implementation and negative admission/ACK/owner/epoch consumers pass',()=>{
  const diagnostics=check();assert.equal(diagnostics.length,0,describe(diagnostics));
});
for(const [label,from,to] of [
  ['commit completion','committed:write.committed,seq:write.seq','committed:true,seq:write.seq'],
  ['local admission versus ACK','committed:write.committed,seq:write.seq','committed:Promise.resolve({operationId:"F",revision:3,ackSeq:1}),seq:write.seq'],
  ['recovery source',"source:/** @type {const} */('v2')","source:/** @type {const} */('saved')"],
  ['owner identity',"const scopedOwner=next,commitPrimary=captureCommitAuthority()","const scopedOwner=200,commitPrimary=captureCommitAuthority()"],
  ['epoch identity','epoch=active.epoch,task={}','epoch=200,task={}'],
  ['recovery authority',"if(!recovered||recovered.appMetadata?.storageRole!=='primary')",'if(!recovered)'],
])test('actual runtime rejects a mutation of '+label,()=>{
  const source=path.join(root,'shared/storage-v2-runtime.js'),original=readFileSync(source,'utf8'),changed=original.replace(from,to);
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345,2367].includes(item.code)),describe(diagnostics));
});

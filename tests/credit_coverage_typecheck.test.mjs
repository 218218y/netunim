import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {root,check,describe} from './typecheck_contract_fixture.mjs';
for(const [file,from,to] of [
  ['credit-coverage.mjs','fetchStatus: errorFetchStatus(error)',"fetchStatus: 'success'"],
  ['credit-coverage.mjs','fetchedAt: null',"fetchedAt: 'now'"],
  ['credit-coverage.mjs',"fetchStatus: 'success'","fetchStatus: 'saved'"],
  ['credit-month-plan.mjs',"tier: cursor <= coreEnd ? 'core' : 'forecast'","tier: 'complete'"],
])test('actual credit coverage rejects '+to,()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge',file),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

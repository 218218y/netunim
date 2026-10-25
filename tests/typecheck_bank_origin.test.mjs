import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('the actual Bank origin policy rejects textual admission decisions',()=>{
  const source=path.join(root,'netunim-kupa/bank-bridge/origin-policy.mjs');
  const original=readFileSync(source,'utf8');
  const changed=original.replace('return custom.has(value)||defaultOriginAllowed(origin);',"return 'allowed';");
  assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&item.code===2322),describe(diagnostics));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('actual restore storage and generic executor compile strictly',()=>{
  const diagnostics=check();assert.equal(diagnostics.length,0,describe(diagnostics));
});
for(const [from,to] of [
  ['return /** @type {Value & RestoreGroup} */ (group);',"return 'accepted';"],
  ['return /** @type {import(\'./restore-group-contracts.js\').StoredRestoreGroup} */ (group);','return true;'],
  ['const result=await applyRemote(current.restoreGroupId);','const result=applyRemote(current.restoreGroupId);'],
  ['await onApplied(current,result);','await onApplied(current,true);'],
])test(`checked restore implementation rejects ${to}`,()=>{
  const target=path.join(root,'shared/restore-groups.js'),original=readFileSync(target,'utf8'),mutated=original.replace(from,to);
  assert.notEqual(original,mutated,from);
  const diagnostics=check(new Map([[target,mutated]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===target&&[2322,2345].includes(item.code)),describe(diagnostics));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {root,check,describe} from './typecheck_contract_fixture.mjs';

test('actual Orders document admission and debt calculations compile strictly',()=>{
  const diagnostics=check();assert.equal(diagnostics.length,0,describe(diagnostics));
});
for(const [file,from,to] of [
  ['shared/data-invariants.js','return /** @type {Record<string,unknown>} */ (state);',"return 'verified';"],
  ['shared/customer-debt-progress.js','paymentApplied:payment.applied,',"paymentApplied:'paid',"],
  ['shared/customer-debt-progress.js',"?'true':progress?.paymentPartial?'partial':'false'","?'true':progress?.paymentPartial?true:'false'"],
  ['netunim-orders/site/assets/js/state/validation.js','return d}', 'return true}'],
])test(`checked ${file} rejects ${to}`,()=>{
  const target=path.join(root,file),original=readFileSync(target,'utf8'),mutated=original.replace(from,to);
  assert.notEqual(original,mutated,from);
  const diagnostics=check(new Map([[target,mutated]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===target&&[2322,2345].includes(item.code)),describe(diagnostics));
});

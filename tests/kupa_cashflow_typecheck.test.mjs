import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {root,check,describe} from './typecheck_contract_fixture.mjs';
for(const [label,from,to] of [
  ['missing balance versus zero','{balance,projected:null}','{balance,projected:0}'],
  ['settlement authority',"bankSettlementState:unresolved.has(index)?'awaiting':'settled'","bankSettlementState:unresolved.has(index)?'awaiting':'matched'"],
  ['billing provenance',"chargeDateSource:'bank_settlement_next_known_cycle'","chargeDateSource:'bank_display_suffix'"],
  ['unknown raw bank amount','value=moneyCents(row.amount)','value=row.amount'],
])test('actual cashflow reconciler rejects '+label,()=>{
  const source=path.join(root,'shared/kupa-cashflow.js'),original=readFileSync(source,'utf8'),changed=original.replace(from,to);assert.notEqual(changed,original);
  const diagnostics=check(new Map([[source,changed]]));
  assert.ok(diagnostics.some(item=>item.file&&path.resolve(item.file.fileName)===source&&[2322,2345,18046].includes(item.code)),describe(diagnostics));
});

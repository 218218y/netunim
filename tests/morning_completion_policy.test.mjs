import {originalMorningCompletionPolicy} from './morning_completion_policy_fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tokens} from './bank_policy_ast_fixture.mjs';
const baseline=JSON.parse(readFileSync(new URL('./fixtures/morning-completion-policies.json',import.meta.url),'utf8'));

for(const [name,expected] of Object.entries(baseline.functions))test('Morning completion preserves '+name,()=>{
 const kind=name==='createMorningDocument'?'issue':'decision',file=kind==='issue'?'morning-issue-command.js':'morning-recovery-decision.js';
 const source=readFileSync(new URL('../netunim-orders/site/assets/js/domains/customers/'+file,import.meta.url),'utf8');
 const actual=originalMorningCompletionPolicy(source,name);
 assert.equal(createHash('sha256').update(tokens(expected.source)).digest('hex'),expected.digest);
 assert.equal(actual,tokens(expected.source));
});

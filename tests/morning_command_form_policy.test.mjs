import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tokens} from './bank_policy_ast_fixture.mjs';
import {baseline,formPolicy} from './morning_command_form_policy_fixture.mjs';
const root=new URL('../netunim-orders/site/assets/js/domains/customers/',import.meta.url);
for(const [name,expected]of Object.entries(baseline.functions))test('Morning command form preserves '+name,()=>{
 const target=['validateTaxId','readForm'].includes(name)?'morning-command-form.js':'morning-debt-confirmation.js';
 const file=existsSync(new URL(target,root))?target:'documents.js',source=readFileSync(new URL(file,root),'utf8');
 assert.equal(createHash('sha256').update(tokens(expected.source)).digest('hex'),expected.digest);assert.deepEqual(formPolicy(source,name),formPolicy(expected.source,name));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
const root=new URL('../netunim-orders/site/assets/js/domains/customers/',import.meta.url);
const baseline=JSON.parse(readFileSync(new URL('./fixtures/morning-catalog-policy.json',import.meta.url),'utf8'));
function clean(value){if(Array.isArray(value))return value.map(clean);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['start','end','raw','loc'].includes(key)).map(([key,v])=>[key,clean(v)]));return value}
for(const name of ['localDate','defaultDocumentSearch','readFilters','allocationMarkup','renderResults','selectInvoice'])test('Morning catalog preserves '+name,()=>{
 const source=readFileSync(new URL(['localDate','defaultDocumentSearch'].includes(name)?'morning-catalog.js':'documents-browser.js',root),'utf8');
 const original=baseline.functions[name];assert.equal(createHash('sha256').update(tokens(original.source)).digest('hex'),original.digest);assert.deepEqual(clean(declaration(source,name)),clean(declaration(original.source,name)));
});

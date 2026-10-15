import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';

const baseline=JSON.parse(readFileSync(new URL('./fixtures/orders-finance-edit-policies.json',import.meta.url),'utf8'));
for(const [file,source] of Object.entries(baseline.policies)){
  const expected=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body;
  for(const node of expected.filter(node=>node.type==='FunctionDeclaration'))test(`Orders ${node.id.name} retains its manual-edit policy`,()=>{
    const actual=readFileSync(new URL('../netunim-orders/site/assets/js/domains/finance/'+file,import.meta.url),'utf8'),moved=declaration(actual,node.id.name);
    assert.equal(tokens(actual.slice(moved.start,moved.end)),tokens(source.slice(node.start,node.end)));
  });
}
